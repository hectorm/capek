import { lookup } from "node:dns";
import { once } from "node:events";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import type { AddressInfo, LookupFunction, Server } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  allowedHost,
  allowedSocket,
  HostNotAllowedError,
  parseHostList,
  pinnedSockets,
} from "#layers/core/server/lib/network";
import { runtimeConfig } from "#layers/core/tests/unit/helpers/nitro-config";

vi.mock("node:dns", () => ({ lookup: vi.fn() }));
vi.mock("node:os", { spy: true });

const resolveDns = vi.mocked(lookup as LookupFunction);

let server: Server;
let serverPort: number;

beforeAll(async () => {
  server = createServer((socket) => {
    socket.on("error", () => undefined).end("connected");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverPort = (server.address() as AddressInfo).port;
});

beforeEach(() => {
  Object.assign(runtimeConfig, { allowedPrivateHosts: "" });
  vi.mocked(networkInterfaces).mockReset();
  resolveDns.mockReset().mockImplementation((_hostname, _options, callback) => {
    callback(null, [{ address: "127.0.0.1", family: 4 }]);
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("host list", () => {
  it("rejects the entries that are not IP addresses, IP ranges or domains with a valid port", () => {
    const entries = [
      "10.0.0.0/33",
      "10.0.0.0/8/8",
      "10.0.0.0/8:80",
      "llm.internal:0",
      "llm.internal:65536",
      "[llm.internal]:80",
      "llm-*.internal",
      "*:80",
      "llm internal",
    ];
    for (const entry of entries) {
      expect(() => parseHostList(`localhost, ${entry}`)).toThrow(`"${entry}"`);
    }
  });

  it.each([
    { label: "any host when all are allowed", list: "*", host: "llm.internal", port: "80" },
    { label: "an allowed domain", list: "llm.internal", host: "llm.internal", port: "80" },
    { label: "the subdomains of an allowed domain", list: "llm.internal", host: "api.llm.internal", port: "80" },
    { label: "the subdomains allowed with a leading dot", list: ".llm.internal", host: "api.llm.internal", port: "80" },
    { label: "the subdomains allowed with a wildcard", list: "*.llm.internal", host: "api.llm.internal", port: "80" },
    { label: "a domain in another case and with a final dot", list: "LLM.Internal.", host: "llm.internal", port: "80" },
    { label: "the allowed port of a domain", list: "llm.internal:8080", host: "llm.internal", port: "8080" },
    { label: "the addresses of an allowed IP range", list: "10.0.0.0/8", host: "10.71.202.222", port: "80" },
    { label: "the allowed port of an IP address", list: "10.71.202.222:8080", host: "10.71.202.222", port: "8080" },
  ])("includes $label", ({ list, host, port }) => {
    const hosts = parseHostList(list);
    expect(hosts.includesName(host, port) || hosts.includesAddress(host, port)).toBe(true);
  });

  it.each([
    { label: "a domain that only ends like an allowed one", list: "llm.internal", host: "allm.internal", port: "80" },
    { label: "a domain when only its subdomains are allowed", list: ".llm.internal", host: "llm.internal", port: "80" },
    { label: "another port of an allowed domain", list: "llm.internal:1", host: "llm.internal", port: "80" },
    { label: "another port of an allowed IP address", list: "10.71.202.222:1", host: "10.71.202.222", port: "80" },
    { label: "an address outside the list", list: "192.168.0.0/16, 10.27.135.212", host: "10.71.202.222", port: "80" },
    { label: "an IP address by the allowed name of its host", list: "localhost", host: "127.0.0.1", port: "80" },
  ])("does not include $label", ({ list, host, port }) => {
    const hosts = parseHostList(list);
    expect(hosts.includesName(host, port) || hosts.includesAddress(host, port)).toBe(false);
  });

  it("matches IPv6 addresses and ranges, with and without a port", () => {
    const hosts = parseHostList("[fc1f:b4a5:af77:291a:37f8:3982:b40e:7d5b]:5432, fcde::/16, ::1");
    expect(hosts.includesAddress("fc1f:b4a5:af77:291a:37f8:3982:b40e:7d5b", "5432")).toBe(true);
    expect(hosts.includesAddress("fc1f:b4a5:af77:291a:37f8:3982:b40e:7d5b", "5433")).toBe(false);
    expect(hosts.includesAddress("fcde:5d3a:5330:6740:9452:4fc4:745d:c6d8", "80")).toBe(true);
    expect(hosts.includesAddress("::1", "80")).toBe(true);
    expect(hosts.includesAddress("fdc0:4d7b:f54a:60b3:d69a:3e0f:3610:d7d2", "80")).toBe(false);
  });

  it("ignores the entries that are not valid when asked", () => {
    const hosts = parseHostList("192.168.*, <local>, llm.example", { ignoreInvalid: true });
    expect(hosts.includesName("api.llm.example", "443")).toBe(true);
  });
});

describe("allowed host", () => {
  it.each([
    { range: "0.0.0.0/8", address: "0.183.228.67" },
    { range: "10.0.0.0/8", address: "10.124.34.150" },
    { range: "100.64.0.0/10", address: "100.72.112.119" },
    { range: "127.0.0.0/8", address: "127.24.101.221" },
    { range: "168.63.129.16/32", address: "168.63.129.16" },
    { range: "169.254.0.0/16", address: "169.254.137.171" },
    { range: "172.16.0.0/12", address: "172.30.182.71" },
    { range: "192.0.0.0/24", address: "192.0.0.173" },
    { range: "192.0.2.0/24", address: "192.0.2.232" },
    { range: "192.88.99.0/24", address: "192.88.99.253" },
    { range: "192.168.0.0/16", address: "192.168.173.70" },
    { range: "198.18.0.0/15", address: "198.18.18.195" },
    { range: "198.51.100.0/24", address: "198.51.100.211" },
    { range: "203.0.113.0/24", address: "203.0.113.219" },
    { range: "224.0.0.0/3", address: "255.255.255.255" },
    { range: "::/128", address: "::" },
    { range: "::1/128", address: "::1" },
    { range: "::ffff:10.0.0.0/104", address: "::ffff:10.165.246.20" },
    { range: "64:ff9b::/96", address: "64:ff9b::aa5:f614" },
    { range: "fc00::/7", address: "fc8a:5942:e632:8948:87b9:cc3a:4ea8:7e80" },
    { range: "fe80::/10", address: "febd:4c2:7c8e:3c10:748f:6d92:8fc:3406" },
    { range: "ff00::/8", address: "ffe3:ef04:98c7:33c7:ca51:4fd8:9c78:7bc6" },
    { range: "2001::/23", address: "2001:be:4887:7353:9a3a:bc3e:c5c5:d5d7" },
    { range: "2001:db8::/32", address: "2001:db8:1f7d:a3b6:95eb:d25:a5d3:83b5" },
    { range: "2002::/16", address: "2002:cb65:e4f0:ac0:701b:9df2:e9a7:6ee3" },
    { range: "3fff::/20", address: "3fff:bc2:390f:95a3:9c4e:5f9d:271c:90b3" },
  ])("is not allowed at the addresses of $range", ({ address }) => {
    expect(() => allowedHost(address, "80")).toThrow(HostNotAllowedError);
  });

  it("is not allowed at the addresses of the server itself, unless they are listed", () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      eth0: [
        { address: "41.101.235.17", family: "IPv4" },
        { address: "2b07:c3d3:746f:9d46:2e14:8df1:217b:d001", family: "IPv6" },
      ],
    } as never);
    for (const address of ["41.101.235.17", "::ffff:41.101.235.17", "2b07:c3d3:746f:9d46:2e14:8df1:217b:d001"]) {
      expect(() => allowedHost(address, "80")).toThrow(HostNotAllowedError);
    }

    Object.assign(runtimeConfig, { allowedPrivateHosts: "41.101.235.17" });
    expect(() => allowedHost("41.101.235.17", "80")).not.toThrow();
  });

  it("is allowed by its name in another case and with a final dot", () => {
    Object.assign(runtimeConfig, { allowedPrivateHosts: "db.internal" });
    expect(allowedHost("DB.Internal.", "80")).toMatchObject({ name: "db.internal", nameAllowed: true });
  });

  it.each([
    { label: "IPv4", address: "3.193.121.204" },
    { label: "IPv6", address: "2b09:4a9d:87c7:5c54:404:8a25:c406:522f" },
    { label: "IPv4-mapped", address: "::ffff:3.193.121.204" },
  ])("is allowed at public $label addresses", ({ address }) => {
    expect(() => allowedHost(address, "80")).not.toThrow();
  });
});

describe("allowed socket", () => {
  it("does not connect to a private host that is not allowed", async () => {
    expect(() => allowedSocket("127.0.0.1", serverPort)).toThrow("private IP address");
    await expect(once(allowedSocket("db.internal", serverPort).connect(), "connect")).rejects.toThrow(
      "private IP address",
    );
  });

  it("connects to an allowed private host, whatever the arguments of its connection", async () => {
    Object.assign(runtimeConfig, { allowedPrivateHosts: `db.internal:${String(serverPort)}` });
    const socket = allowedSocket("db.internal", serverPort);
    socket.connect(1, "elsewhere.example");
    const [data] = (await once(socket, "data")) as [Buffer];
    expect(data.toString()).toBe("connected");
    expect(resolveDns).toHaveBeenCalledWith(
      "db.internal",
      expect.objectContaining({ all: true }),
      expect.any(Function),
    );
  });

  it("connects to the given address of a host only when it is allowed", async () => {
    Object.assign(runtimeConfig, { allowedPrivateHosts: "db.internal" });
    const socket = allowedSocket("db.internal", serverPort, "127.0.0.1").connect();
    await once(socket, "connect");
    expect(resolveDns).not.toHaveBeenCalled();
    socket.destroy();

    await expect(once(allowedSocket("db.example", serverPort, "127.0.0.1").connect(), "connect")).rejects.toThrow(
      "private IP address",
    );
  });
});

describe("pinned sockets", () => {
  it("connect to the server of the first one", async () => {
    Object.assign(runtimeConfig, { allowedPrivateHosts: "db.internal" });
    const sockets = pinnedSockets("db.internal", serverPort);
    const first = sockets().connect();
    await once(first, "connect");
    first.destroy();
    resolveDns.mockReset().mockImplementation((_hostname, _options, callback) => {
      callback(null, [{ address: "127.0.0.2", family: 4 }]);
    });
    const second = sockets().connect();
    await once(second, "connect");
    expect(resolveDns).not.toHaveBeenCalled();
    expect(second.remoteAddress).toBe("127.0.0.1");
    second.destroy();
  });
});
