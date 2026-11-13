import { describe, expect, it } from "vitest";

import { MariaDBDriver } from "#layers/datasources/server/lib/drivers/mariadb";

describe("MariaDB driver", () => {
  it("rejects connection options that would read files or allow writes", async () => {
    const run = (options: string) => {
      const config = { connectionString: `mariadb://db.example.com/sales?${options}`, authType: "none" };
      return new MariaDBDriver().execute({ config }, "SELECT 1", {});
    };

    await expect(run("permitLocalInfile=true")).rejects.toThrow('The option "permitLocalInfile"');
    await expect(run("ssl=true&multipleStatements=true")).rejects.toThrow('The option "multipleStatements"');
  });
});
