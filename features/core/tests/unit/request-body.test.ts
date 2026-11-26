import { once } from "node:events";
import { createServer, request } from "node:http";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import type { H3Event } from "h3";
import { createApp, eventHandler, toNodeListener } from "h3";
import { describe, expect, it, vi } from "vitest";

import {
  collectBodyLimits,
  DEFAULT_BODY_LIMIT,
  readUploadBody,
  resolveBodyLimit,
  startBodyDeadline,
} from "#layers/core/server/lib/request-body";

const eventAt = (path: string): H3Event => ({ path }) as H3Event;
const eventOf = (body: PassThrough): H3Event => ({ node: { req: body } }) as unknown as H3Event;

describe("request body limit", () => {
  const limits = collectBodyLimits([
    { name: "core" },
    {
      name: "files",
      bodyLimits: {
        "/api/files/upload": 100,
        "/api/files/import": () => Promise.resolve(200),
        "/api/files/restore": () => Number.NaN,
      },
    },
  ]);

  it("is the default one for the routes without a valid limit of their own", async () => {
    await expect(resolveBodyLimit(limits, eventAt("/api/trpc/user.read"))).resolves.toBe(DEFAULT_BODY_LIMIT);
    await expect(resolveBodyLimit(limits, eventAt("/api/files/upload/"))).resolves.toBe(DEFAULT_BODY_LIMIT);
    await expect(resolveBodyLimit(limits, eventAt("/api/files/restore"))).resolves.toBe(DEFAULT_BODY_LIMIT);
  });

  it("is the one that a feature sets for its route", async () => {
    await expect(resolveBodyLimit(limits, eventAt("/api/files/upload"))).resolves.toBe(100);
    await expect(resolveBodyLimit(limits, eventAt("/api/files/upload?overwrite=1"))).resolves.toBe(100);
    await expect(resolveBodyLimit(limits, eventAt("/api/files/import"))).resolves.toBe(200);
  });

  it("is only set by a feature for its own routes", () => {
    expect(() => collectBodyLimits([{ name: "files", bodyLimits: { "/api/inventory/import": 100 } }])).toThrow(
      /Route "\/api\/inventory\/import" of feature "files" must start with "\/api\/files\/"/,
    );
    expect(() => {
      return collectBodyLimits([
        { name: "core", bodyLimits: { "/api/files/upload": 100 } },
        { name: "files", bodyLimits: { "/api/files/upload": 200 } },
      ]);
    }).toThrow(/Duplicate body limit of route "\/api\/files\/upload" in feature "files"/);
  });
});

describe("upload bodies", () => {
  it("keeps the ordinary body deadline while a file upload is running", async () => {
    const reading = Promise.withResolvers<undefined>();
    const app = createApp().use(
      eventHandler(async (event) => {
        startBodyDeadline(event, 100);
        if (event.path === "/upload") {
          const body = readUploadBody(event).resume();
          reading.resolve(undefined);
          await once(body, "end");
          return "";
        }
        event.node.req.resume();
        await once(event.node.req, "close");
        return "";
      }),
    );
    await using server = createServer({ requestTimeout: 0, headersTimeout: 100 }, toNodeListener(app));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const options = {
      hostname: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
      method: "PUT",
      headers: { "Content-Length": 2 },
      agent: false as const,
    };
    const upload = request({ ...options, path: "/upload" });
    const ordinary = request({ ...options, path: "/ordinary" });
    try {
      const uploaded = once(upload, "response");
      upload.write("a");
      await reading.promise;
      const expired = once(ordinary, "response");
      ordinary.write("a");
      const [timeoutResponse] = (await expired) as [IncomingMessage];
      expect(timeoutResponse.statusCode).toBe(408);
      timeoutResponse.resume();
      upload.end("b");
      const [uploadResponse] = (await uploaded) as [IncomingMessage];
      expect(uploadResponse.statusCode).toBe(200);
      uploadResponse.resume();
    } finally {
      upload.destroy();
      ordinary.destroy();
      server.closeAllConnections();
    }
  });

  it("times out only while waiting for the next bytes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const body = new PassThrough();
    const reader = readUploadBody(eventOf(body))[Symbol.asyncIterator]();
    try {
      for (const value of ["one", "two"]) {
        const reading = reader.next();
        await vi.advanceTimersByTimeAsync(240_000);
        body.write(value);
        expect(String((await reading).value)).toBe(value);
        await vi.advanceTimersByTimeAsync(360_000);
        expect(body.destroyed).toBe(false);
      }

      const stalled = expect(reader.next()).rejects.toMatchObject({ statusCode: 408 });
      await vi.advanceTimersByTimeAsync(300_000);
      await stalled;
      expect(body.destroyed).toBe(true);
    } finally {
      body.destroy();
      vi.useRealTimers();
    }
  });
});
