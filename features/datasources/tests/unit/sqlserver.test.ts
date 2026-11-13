import { describe, expect, it } from "vitest";

import { databaseCredential, SqlServerDriver } from "#layers/datasources/server/lib/drivers/sqlserver";

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
});
