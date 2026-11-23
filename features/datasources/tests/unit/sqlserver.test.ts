import { lookup } from "node:dns";
import { once } from "node:events";
import { createServer } from "node:net";
import type { AddressInfo, LookupFunction } from "node:net";

import { instanceLookup } from "tedious/lib/instance-lookup.js";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { runtimeConfig } from "#layers/core/tests/unit/helpers/nitro-config";
import { databaseCredential, SqlServerDriver } from "#layers/datasources/server/lib/drivers/sqlserver";

vi.mock("node:dns", () => ({ lookup: vi.fn() }));
vi.mock("tedious/lib/instance-lookup.js", { spy: true });

const resolveDns = vi.mocked(lookup as LookupFunction);

beforeEach(() => {
  Object.assign(runtimeConfig, { allowedPrivateHosts: "" });
  vi.mocked(instanceLookup).mockReset();
  resolveDns.mockReset();
});

describe("SQL Server driver", () => {
  it("only sends managed identity tokens to Azure databases", async () => {
    const config = { connectionString: "Server=attacker.example,1433", authType: "azure-managed-identity" };
    await expect(new SqlServerDriver().execute({ config }, "SELECT 1", {})).rejects.toThrow(
      "Managed identities only connect to the databases of Azure",
    );
  });

  it("only asks for managed identity tokens to reach databases", async () => {
    await expect(databaseCredential("").getToken("https://management.azure.com/.default")).rejects.toThrow(
      "which is not a database",
    );
  });

  it("does not connect to a private host that is not allowed", async () => {
    resolveDns.mockImplementation((_hostname, _options, callback) => {
      callback(null, [{ address: "10.91.146.119", family: 4 }]);
    });
    for (const connectionString of [
      "Server=db.internal,1433",
      "Server=db.internal\\SQLEXPRESS",
      "Server=db.internal\\",
    ]) {
      const config = { connectionString, authType: "none" };
      await expect(new SqlServerDriver().execute({ config }, "SELECT 1", {})).rejects.toThrow("private IP address");
    }
  });

  it("connects to the port of a named instance", async () => {
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    onTestFinished(async () => {
      await new Promise((resolve) => server.close(resolve));
    });
    Object.assign(runtimeConfig, { allowedPrivateHosts: "127.0.0.1" });
    vi.mocked(instanceLookup).mockResolvedValue((server.address() as AddressInfo).port);
    const connection = once(server, "connection");

    const config = { connectionString: "Server=127.0.0.1\\SQLEXPRESS", authType: "none" };
    await expect(new SqlServerDriver().execute({ config }, "SELECT 1", {})).rejects.toThrow("Connection lost");
    await connection;
  });

  it("stops looking up a named instance when its signal aborts", async () => {
    resolveDns.mockImplementation(() => undefined);
    const controller = new AbortController();
    const stopped = new Error("stopped");
    const config = { connectionString: "Server=db.example.com\\SQLEXPRESS", authType: "none" };
    const request = new SqlServerDriver().execute({ config }, "SELECT 1", { signal: controller.signal });
    await vi.waitFor(() => {
      expect(resolveDns).toHaveBeenCalled();
    });
    controller.abort(stopped);
    await expect(request).rejects.toBe(stopped);
  });

  it("reports a named instance that cannot be found", async () => {
    vi.mocked(instanceLookup).mockRejectedValue(new Error("no browser"));
    const config = { connectionString: "Server=db.example.com\\SQLEXPRESS", authType: "none" };
    await expect(new SqlServerDriver().execute({ config }, "SELECT 1", {})).rejects.toThrow(
      'The instance "SQLEXPRESS" of "db.example.com" could not be found',
    );
    expect(instanceLookup).toHaveBeenCalledWith(
      expect.objectContaining({ server: "db.example.com", instanceName: "SQLEXPRESS" }),
    );
  });
});
