import { lookup } from "node:dns";
import { once } from "node:events";
import http from "node:http";
import type { LookupAddress } from "node:dns";
import type { AddressInfo, LookupFunction } from "node:net";
import type { Duplex } from "node:stream";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Endpoint } from "#layers/core/server/lib/http";
import {
  fetchEndpoint,
  limitResponse,
  readErrorBody,
  readErrorMessage,
  unredactEndpoint,
} from "#layers/core/server/lib/http";
import { HTTP_REDACTED_VALUE } from "#layers/core/shared/http";
import { runtimeConfig } from "#layers/core/tests/unit/helpers/nitro-config";

vi.mock("node:dns", () => ({ lookup: vi.fn() }));

const resolveDns = vi.mocked(lookup as LookupFunction);

const stored: Endpoint = {
  url: "https://api.example.com/v1",
  apiKey: "stored-key",
  headers: [{ name: "X-Token", value: "stored-token" }],
};

const hiddenHeaders = [{ name: "X-Token", value: HTTP_REDACTED_VALUE }];

describe("endpoint secret", () => {
  it("is taken from the stored endpoint when missing or hidden", () => {
    expect(unredactEndpoint({}, stored)).toEqual(stored);
    expect(unredactEndpoint({ url: stored.url, apiKey: HTTP_REDACTED_VALUE, headers: hiddenHeaders }, stored)).toEqual(
      stored,
    );
    expect(unredactEndpoint({ apiKey: "typed-key", headers: [] }, stored)).toEqual({
      url: stored.url,
      apiKey: "typed-key",
      headers: [],
    });
  });

  it("is not sent to another URL", () => {
    const url = "https://attacker.example/v1";

    const sentWithStoredSecrets = [
      { url },
      { url, apiKey: "typed-key" },
      { url, apiKey: "typed-key", headers: hiddenHeaders },
      { url, apiKey: HTTP_REDACTED_VALUE, headers: [] },
    ];
    for (const sent of sentWithStoredSecrets) {
      expect(() => unredactEndpoint(sent, stored)).toThrow(/have to be entered again/);
    }

    const headers = [{ name: "X-Token", value: "typed-token" }];
    expect(unredactEndpoint({ url, apiKey: "typed-key", headers }, stored)).toEqual({
      url,
      apiKey: "typed-key",
      headers,
    });
  });

  it("is not needed to move an endpoint without secrets", () => {
    const url = "https://other.example/v1";

    expect(unredactEndpoint({ url }, { url: stored.url, apiKey: "", headers: [] })).toEqual({
      url,
      apiKey: "",
      headers: [],
    });
  });

  it("is left empty when hidden and not stored", () => {
    const url = "https://other.example/v1";

    expect(unredactEndpoint({ url, apiKey: HTTP_REDACTED_VALUE, headers: hiddenHeaders }, undefined)).toEqual({
      url,
      apiKey: "",
      headers: [{ name: "X-Token", value: "" }],
    });
  });
});

describe("bounded responses", () => {
  it("preserves the response metadata and accepts a body exactly at the byte limit", async () => {
    const response = limitResponse(new Response("éé", { status: 201, headers: { "X-Test": "kept" } }), 4, "too large");
    expect(response.status).toBe(201);
    expect(response.headers.get("X-Test")).toBe("kept");
    expect(await response.text()).toBe("éé");
    const empty = new Response(null, { status: 204 });
    expect(limitResponse(empty, 0, "too large")).toBe(empty);
  });

  it("counts bytes across chunks and cancels an oversized response before it ends", async () => {
    const cancelled = Promise.withResolvers();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("é"));
        controller.enqueue(new TextEncoder().encode("é"));
      },
      cancel: cancelled.resolve,
    });
    const response = limitResponse(new Response(source), 3, "too large");
    await expect(response.text()).rejects.toThrow("too large");
    await cancelled.promise;
  });

  it("reads the first 16 KiB of an error body", async () => {
    const prefix = "é".repeat(8192);
    const response = new Response(`${prefix}tail`, { status: 500 });
    expect(await readErrorBody(response.body)).toBe(prefix);
  });
});

describe("failed response", () => {
  const describeFailure = (body: string, status: number): Promise<string> => {
    return readErrorMessage(new Response(body, { status }));
  };

  it("is described by the message of an API error", async () => {
    const bodies = [
      { error: { message: "No such model", type: "invalid_request_error" } },
      { error: "No such model" },
      { message: "No such model" },
      { detail: "No such model" },
    ];
    for (const body of bodies) {
      expect(await describeFailure(JSON.stringify(body), 404)).toBe("404 Not Found: No such model");
    }

    const long = JSON.stringify({ error: { message: "x".repeat(2000) } });
    expect(await describeFailure(long, 400)).toBe(`400 Bad Request: ${"x".repeat(1000)}...`);
  });

  it("uses the supplied error body after the response has been read", async () => {
    const response = Response.json({ error: "Unavailable" }, { status: 500 });
    const body = await response.text();
    expect(await readErrorMessage(response, body)).toBe("500 Internal Server Error: Unavailable");
  });

  it("is described only by its status when the body is not an API error", async () => {
    const bodies = ["", "internal secret", '{"token":"internal secret"}', '{"error":{"message":" "}}'];
    for (const body of bodies) {
      expect(await describeFailure(body, 403)).toBe("403 Forbidden");
    }
  });
});

describe("endpoint request", () => {
  let server: http.Server;
  let port: string;
  let requests: number;
  let lastRequest: http.IncomingMessage | undefined;
  let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  let addresses: LookupAddress[];
  const destinations: LookupAddress[] = [];
  const publicAddress = { address: "3.193.121.204", family: 4 };
  const privateAddress = { address: "10.137.17.89", family: 4 };
  const urlOf = (host: string): string => `http://${host}:${port}/endpoint`;
  const allowHosts = (list: string): void => {
    Object.assign(runtimeConfig, { allowedPrivateHosts: list.replace("{port}", port) });
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests++;
      lastRequest = req;
      res.setHeader("Connection", "close");
      respond(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = String((server.address() as AddressInfo).port);
  });

  beforeEach(() => {
    requests = 0;
    lastRequest = undefined;
    destinations.length = 0;
    addresses = [publicAddress];
    allowHosts("");
    respond = (_req, res) => res.end();
    resolveDns.mockReset().mockImplementation((_hostname, _options, callback) => {
      callback(null, addresses);
    });

    // Only addresses accepted by the connection lookup are routed to the test server
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { createConnection } = http.Agent.prototype;
    vi.spyOn(http.Agent.prototype, "createConnection").mockImplementation(function (
      this: http.Agent,
      options,
      callback,
    ) {
      const checkedLookup = options.lookup;
      if (checkedLookup) {
        options.lookup = (hostname, lookupOptions, done) => {
          checkedLookup(hostname, lookupOptions, (error, address, family) => {
            if (error) {
              done(error, "");
              return;
            }
            destinations.push(...(Array.isArray(address) ? address : [{ address, family: family ?? 4 }]));
            done(null, lookupOptions.all ? [{ address: "127.0.0.1", family: 4 }] : "127.0.0.1", 4);
          });
        };
      }
      return createConnection.call(this, options, callback);
    });
  });

  afterEach(() => {
    server.closeAllConnections();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it.each([
    { label: "a URL that is not HTTP", url: "file:///etc/passwd", message: "must use HTTP" },
    { label: "a URL with credentials", url: "https://user:password@llm.example/v1", message: "must use HTTP" },
    { label: "an IPv4 loopback address", url: "http://127.0.0.1/v1", message: "private IP address" },
    { label: "the metadata address", url: "http://169.254.169.254/latest/meta-data", message: "private IP address" },
    { label: "an IPv6 loopback address", url: "http://[::1]/v1", message: "private IP address" },
    { label: "an IPv4-mapped loopback address", url: "http://[::ffff:127.0.0.1]/v1", message: "private IP address" },
  ])("rejects $label before connecting", async ({ url, message }) => {
    await expect(fetchEndpoint(url)).rejects.toThrow(message);
    expect(resolveDns).not.toHaveBeenCalled();
    expect(requests).toBe(0);
  });

  it.each([
    { label: "IPv4", address: publicAddress },
    { label: "IPv6", address: { address: "2b09:4a9d:87c7:5c54:404:8a25:c406:522f", family: 6 } },
  ])("is sent to the checked $label address", async ({ address }) => {
    addresses = [address];
    respond = (req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        res.end(
          JSON.stringify({ method: req.method, agent: req.headers["user-agent"], token: req.headers["x-token"], body }),
        );
      });
    };
    const response = await fetchEndpoint(urlOf("llm.example"), {
      method: "POST",
      headers: { "X-Token": "secret" },
      body: '{"model":"reasoner"}',
    });
    expect(await response.json()).toEqual({
      method: "POST",
      agent: runtimeConfig.httpUserAgent,
      token: "secret",
      body: '{"model":"reasoner"}',
    });
    expect(destinations).toEqual([address]);
  });

  it("rejects a host with a private address, even among public ones", async () => {
    addresses = [publicAddress, privateAddress];
    await expect(fetchEndpoint(urlOf("llm.example"))).rejects.toThrow("private IP address");
    expect(requests).toBe(0);
  });

  it("does not let its headers change the framing of the request", async () => {
    respond = (req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => res.end(`${String(req.headers["content-length"])} ${body}`));
    };
    const headers = {
      "Content-Length": "2",
      "Transfer-Encoding": "chunked",
      Connection: "upgrade",
      Expect: "100-continue",
    };
    const response = await fetchEndpoint(urlOf("llm.example"), { method: "POST", headers, body: '{"a":1}' });
    expect(await response.text()).toBe('7 {"a":1}');
    expect(requests).toBe(1);
  });

  it.each([
    { label: "a buffer", body: Buffer.from([0, 255, 128, 13, 10]) },
    { label: "a byte view", body: new Uint8Array([99, 0, 255, 128, 13, 10, 99]).subarray(1, 6) },
  ])("sends $label without changing its bytes or including bytes outside its view", async ({ body }) => {
    respond = (req, res) => req.pipe(res);
    const response = await fetchEndpoint(urlOf("files.example"), { method: "PUT", body });
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0, 255, 128, 13, 10]));
  });

  it("has no body when its status has none", async () => {
    const closed = Promise.withResolvers();
    respond = (_req, res) => {
      res.socket?.on("close", closed.resolve).write("HTTP/1.1 205 Reset Content\r\nTransfer-Encoding: chunked\r\n\r\n");
    };
    expect((await fetchEndpoint(urlOf("llm.example"))).body).toBeNull();
    await closed.promise;
  });

  it("rejects a response whose status is not valid", async () => {
    respond = (_req, res) => {
      res.socket?.end("HTTP/1.1 600 Unknown\r\nContent-Length: 0\r\n\r\n");
    };
    await expect(fetchEndpoint(urlOf("llm.example"))).rejects.toThrow(RangeError);
  });

  it("rejects a response that switches to another protocol", async () => {
    respond = (_req, res) => {
      res.socket?.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: other\r\nConnection: Upgrade\r\n\r\n");
    };
    await expect(fetchEndpoint(urlOf("llm.example"))).rejects.toThrow("switched to another protocol");
  });

  it("does not follow redirects", async () => {
    respond = (_req, res) => res.writeHead(302, { Location: "http://169.254.169.254/" }).end();
    await expect(fetchEndpoint(urlOf("llm.example"))).rejects.toThrow('redirects to "http://169.254.169.254/"');
    expect(requests).toBe(1);
  });

  it("follows redirects when asked, checking each destination with plain GET requests", async () => {
    const seen: string[] = [];
    respond = (req, res) => {
      seen.push(`${String(req.method)} ${String(req.url)} ${String(req.headers["x-token"])}`);
      if (req.url === "/endpoint") {
        res.writeHead(307, { Location: "next" }).end();
      } else if (req.url === "/next") {
        res.writeHead(301, { Location: new URL("/final", urlOf("cdn.example")).href }).end();
      } else {
        res.end();
      }
    };
    const init = { method: "POST", headers: { "X-Token": "secret" }, body: "{}", redirect: "follow" } as const;
    await fetchEndpoint(urlOf("pictures.example"), init);
    expect(lastRequest?.headers.host).toBe(`cdn.example:${port}`);
    expect(seen).toEqual(["POST /endpoint secret", "GET /next undefined", "GET /final undefined"]);
    expect(resolveDns).toHaveBeenCalledTimes(3);
    expect(destinations).toEqual([publicAddress, publicAddress, publicAddress]);
  });

  it("does not follow a redirect to a private address", async () => {
    respond = (_req, res) => res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" }).end();
    await expect(fetchEndpoint(urlOf("pictures.example"), { redirect: "follow" })).rejects.toThrow(
      "private IP address",
    );
    expect(requests).toBe(1);
  });

  it("stops following redirects after a few", async () => {
    respond = (_req, res) => res.writeHead(302, { Location: "/endpoint" }).end();
    await expect(fetchEndpoint(urlOf("pictures.example"), { redirect: "follow" })).rejects.toThrow("too many times");
    expect(requests).toBe(4);
  });

  it.each([
    { label: "any host when all are allowed", list: "*", host: "llm.internal" },
    { label: "the allowed port of a domain", list: "llm.internal:{port}", host: "llm.internal" },
    { label: "the addresses of an allowed IP range", list: "10.0.0.0/8", host: "llm.internal" },
    { label: "an allowed IP address in the URL", list: "localhost, 127.0.0.1:{port}", host: "127.0.0.1" },
  ])("reaches $label", async ({ list, host }) => {
    allowHosts(list);
    addresses = [privateAddress];
    await fetchEndpoint(urlOf(host));
    expect(lastRequest?.headers.host).toBe(`${host}:${port}`);
  });

  it("is sent through the proxy of the environment after checking the addresses of its host", async () => {
    vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${port}`);
    await fetchEndpoint(urlOf("llm.example"));
    expect(lastRequest?.url).toBe(urlOf("llm.example"));
    expect(resolveDns).toHaveBeenCalledWith("llm.example", { all: true }, expect.any(Function));
    expect(destinations).toEqual([]);
  });

  it("is not sent through the proxy of the environment when its host has a private address", async () => {
    vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${port}`);
    addresses = [privateAddress];
    await expect(fetchEndpoint(urlOf("llm.example"))).rejects.toThrow("private IP address");
    expect(requests).toBe(0);
  });

  it("is sent through the proxy of the environment when only the proxy can resolve its host", async () => {
    vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${port}`);
    resolveDns.mockImplementation((hostname, _options, callback) => {
      callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), "");
    });
    await fetchEndpoint(urlOf("llm.example"));
    expect(lastRequest?.url).toBe(urlOf("llm.example"));
  });

  it("is not sent through the proxy when its signal aborts while checking its host", async () => {
    vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${port}`);
    resolveDns.mockImplementation(() => undefined);
    const controller = new AbortController();
    const stopped = new Error("stopped");
    const request = fetchEndpoint(urlOf("llm.example"), { signal: controller.signal });
    controller.abort(stopped);
    await expect(request).rejects.toBe(stopped);
    expect(requests).toBe(0);
  });

  it("is tunnelled through the proxy of the environment when its URL is HTTPS", async () => {
    vi.stubEnv("HTTPS_PROXY", `http://127.0.0.1:${port}`);
    const tunnel = Promise.withResolvers<string | undefined>();
    server.once("connect", (req: http.IncomingMessage, socket: Duplex) => {
      tunnel.resolve(req.url);
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
    await expect(fetchEndpoint("https://llm.example/v1")).rejects.toThrow();
    expect(await tunnel.promise).toBe("llm.example:443");
  });

  it.each([
    { label: "without a scheme", proxy: "127.0.0.1:{port}" },
    { label: "with an uppercase scheme", proxy: "HTTP://127.0.0.1:{port}" },
  ])("is sent through a proxy $label", async ({ proxy }) => {
    vi.stubEnv("HTTP_PROXY", proxy.replace("{port}", port));
    await fetchEndpoint(urlOf("llm.example"));
    expect(lastRequest?.url).toBe(urlOf("llm.example"));
  });

  it("is sent through the lowercase proxy variable when the uppercase one is empty", async () => {
    vi.stubEnv("http_proxy", `http://127.0.0.1:${port}`);
    await fetchEndpoint(urlOf("llm.example"));
    expect(lastRequest?.url).toBe(urlOf("llm.example"));
  });

  it("is not sent through a proxy that is not an HTTP or HTTPS URL", async () => {
    vi.stubEnv("HTTP_PROXY", `socks5://127.0.0.1:${port}`);
    await expect(fetchEndpoint(urlOf("llm.example"))).rejects.toThrow("HTTP or HTTPS URL");
    expect(requests).toBe(0);
  });

  it("is sent through the proxy to the host of its URL, whatever its Host header", async () => {
    vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${port}`);
    await fetchEndpoint(urlOf("llm.example"), { headers: { Host: "127.0.0.1" } });
    expect(lastRequest?.url).toBe(urlOf("llm.example"));
    expect(lastRequest?.headers.host).toBe(`llm.example:${port}`);
  });

  it.each([
    { label: "a loopback name", host: "localhost" },
    { label: "a loopback address", host: "127.0.0.1" },
  ])("is not sent through the proxy to $label", async ({ host }) => {
    vi.stubEnv("HTTP_PROXY", "http://127.0.0.1:9");
    allowHosts(`${host}:{port}`);
    addresses = [{ address: "127.0.0.1", family: 4 }];
    await fetchEndpoint(urlOf(host));
    expect(lastRequest?.headers.host).toBe(`${host}:${port}`);
  });

  it("is not sent through the proxy to the hosts of NO_PROXY", async () => {
    vi.stubEnv("HTTP_PROXY", "http://127.0.0.1:9");
    vi.stubEnv("NO_PROXY", "localhost, 192.168.*, <local>, .example");
    await fetchEndpoint(urlOf("llm.example"));
    expect(lastRequest?.headers.host).toBe(`llm.example:${port}`);
    expect(destinations).toEqual([publicAddress]);
  });

  it("fails with the reason of its signal while the proxy has not opened its tunnel", async () => {
    vi.stubEnv("HTTPS_PROXY", `http://127.0.0.1:${port}`);
    const tunnel = Promise.withResolvers<Duplex>();
    server.once("connect", (_req: http.IncomingMessage, socket: Duplex) => {
      tunnel.resolve(socket.on("error", () => undefined));
    });
    const controller = new AbortController();
    const stopped = new Error("stopped");
    const request = fetchEndpoint("https://llm.example/v1", { signal: controller.signal });
    const held = await tunnel.promise;
    controller.abort(stopped);
    await expect(request).rejects.toBe(stopped);
    held.destroy();
  });

  it("gives up when the connection is not accepted in time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    resolveDns.mockImplementation(() => undefined);
    const request = expect(fetchEndpoint(urlOf("llm.example"))).rejects.toThrow(
      "did not accept the connection in time",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await request;
  });

  it("gives up when the response does not start in time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const received = Promise.withResolvers();
    respond = (_req, res) => {
      res.socket?.write("HTTP/1.1 103 Early Hints\r\n\r\n", received.resolve);
    };
    const request = expect(fetchEndpoint(urlOf("llm.example"))).rejects.toThrow("did not answer in time");
    await received.promise;
    await vi.advanceTimersByTimeAsync(300_000);
    await request;
  });

  it("fails with the reason of its signal, before and during the response", async () => {
    const stopped = new Error("stopped");
    await expect(fetchEndpoint(urlOf("llm.example"), { signal: AbortSignal.abort(stopped) })).rejects.toBe(stopped);
    expect(requests).toBe(0);

    const waiting = Promise.withResolvers<http.ServerResponse>();
    respond = (_req, res) => {
      waiting.resolve(res);
    };
    const beforeResponse = new AbortController();
    const request = fetchEndpoint(urlOf("llm.example"), { signal: beforeResponse.signal });
    const closedBefore = once(await waiting.promise, "close");
    beforeResponse.abort(stopped);
    await expect(request).rejects.toBe(stopped);
    await closedBefore;

    const writing = Promise.withResolvers<http.ServerResponse>();
    respond = (_req, res) => {
      res.write("partial");
      writing.resolve(res);
    };
    const duringResponse = new AbortController();
    const response = await fetchEndpoint(urlOf("llm.example"), { signal: duringResponse.signal });
    const closedDuring = once(await writing.promise, "close");
    duringResponse.abort(stopped);
    await expect(response.text()).rejects.toBe(stopped);
    await closedDuring;
  });
});
