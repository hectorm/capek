import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fetchUserPicture, userPicturePath } from "#layers/core/server/lib/authn/picture";

// Server that answers as the one of the pictures of an identity provider or as another service
let server: http.Server;
let respond: (res: http.ServerResponse) => void;
let url: string;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    respond(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/picture`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("user picture", () => {
  it("is served from a path that changes with its URL", () => {
    const path = userPicturePath("https://idp.example.com/alice.png");

    expect(path).toMatch(/^\/api\/user\/picture\?v=[0-9a-f]{16}$/);
    expect(userPicturePath("https://idp.example.com/alice-2.png")).not.toBe(path);
    expect(userPicturePath("file:///etc/passwd")).toBeNull();
    expect(userPicturePath(null)).toBeNull();
  });

  it("is the image of its URL", async () => {
    respond = (res) => res.writeHead(200, { "Content-Type": "image/png; charset=binary" }).end("picture");

    await expect(fetchUserPicture(url)).resolves.toEqual({ mimeType: "image/png", data: Buffer.from("picture") });
  });

  it("is not what another server answers", async () => {
    const answers: ((res: http.ServerResponse) => void)[] = [
      (res) => res.writeHead(200, { "Content-Type": "application/json" }).end('{"token":"internal secret"}'),
      (res) => res.writeHead(200, { "Content-Type": "image/svg+xml" }).end("<svg><script>alert(1)</script></svg>"),
      (res) => res.writeHead(403, { "Content-Type": "image/png" }).end("internal secret"),
      (res) => res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" }).end(),
      (res) => res.writeHead(200, { "Content-Type": "image/png" }).end(Buffer.alloc(1024 * 1024 + 1)),
    ];

    for (const answer of answers) {
      respond = answer;
      await expect(fetchUserPicture(url)).rejects.toThrow();
    }
  });
});
