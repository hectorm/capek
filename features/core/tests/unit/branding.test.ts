import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp, createRouter, toNodeListener } from "h3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import branding from "#layers/core/server/api/branding/[type].get";
import { closeDb, createTestDb } from "#layers/core/tests/unit/helpers/db";
import { runtimeConfig } from "#layers/core/tests/unit/helpers/nitro-config";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  Object.assign(runtimeConfig, { branding: { logo: "/acme/logo.svg", icon: "/api/logout" } });
  await createTestDb();

  const app = createApp();
  app.use(createRouter().get("/api/branding/:type", branding));
  server = createServer(toNodeListener(app));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDb();
});

describe("branding", () => {
  it("redirects to the image of the public directory that the configuration names", async () => {
    const response = await fetch(`${baseUrl}/api/branding/logo`, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/acme/logo.svg");
  });

  it("does not redirect to a path that is not an image", async () => {
    const response = await fetch(`${baseUrl}/api/branding/icon`, { redirect: "manual" });

    expect(response.status).toBe(500);
    expect(response.headers.get("Location")).toBeNull();
  });
});
