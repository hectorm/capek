import type { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ToolContext } from "#layers/core/server/lib/tools/define";
import type { Database } from "#layers/core/shared/schema";
import coreFeature from "#layers/core/server/feature";
import { listResources } from "#layers/core/server/lib/authz/resources";
import { collectToolProviders } from "#layers/core/server/lib/tools/define";
import { asUser, closeDb, createTestDb } from "#layers/core/tests/unit/helpers/db";
import datasourcesFeature from "#layers/datasources/server/feature";
import { datasourceTypes, findDatasourceType } from "#layers/datasources/server/lib/drivers";
import { datasourcesToolProvider } from "#layers/datasources/server/lib/tools";
import { DatasourceTypes } from "#layers/datasources/shared/definitions";

let db: Kysely<Database>;

// Database that the datasource of the tests connects to
let salesDb: PGlite;
let salesServer: PGLiteSocketServer;

const alice = crypto.randomUUID();
const salesId = crypto.randomUUID();
const legacyId = crypto.randomUUID();

const features = [coreFeature, datasourcesFeature];
const context = { user: { id: alice } } as ToolContext;

beforeAll(async () => {
  salesDb = new PGlite();
  await salesDb.exec(
    "CREATE TABLE orders (id INT PRIMARY KEY, total INT); INSERT INTO orders VALUES (1, 10), (2, 20);",
  );
  salesServer = new PGLiteSocketServer({ db: salesDb, host: "127.0.0.1", port: 0 });
  await salesServer.start();

  db = await createTestDb([datasourcesFeature]);

  await db
    .insertInto("users")
    .values([{ id: alice, username: "alice", fullname: "Alice", email: "alice@example.com" }])
    .execute();
  await db
    .insertInto("datasourcesSources")
    .values([
      {
        id: salesId,
        name: "sales",
        description: "",
        documentation: "Table `orders(id, total)`",
        type: "postgres",
        config: JSON.stringify({
          connectionString: `postgres://${salesServer.getServerConn()}/postgres`,
          authType: "basic",
          username: "postgres",
          password: "postgres",
        }),
      },
      {
        id: legacyId,
        name: "legacy",
        description: "",
        documentation: null,
        type: "removed",
        config: JSON.stringify({}),
      },
    ])
    .execute();
  await db.insertInto("datasourcesSourceAccess").values({ sourceId: salesId, userId: alice, role: "user" }).execute();
});

afterAll(async () => {
  await closeDb();
  await salesServer.stop();
  await salesDb.close();
});

describe("datasources", () => {
  it("only shows the datasources shared with the user", async () => {
    const visible = (granted: string[]): Promise<string[]> => {
      return asUser({ id: alice, permissions: granted }, async (trx) => {
        const rows = await trx.selectFrom("datasourcesSources").select(["name"]).orderBy("name").execute();
        return rows.map((row) => row.name);
      });
    };

    expect(await visible(["datasources_source:read:own", "datasources_source:list:own"])).toEqual(["sales"]);
    expect(await visible(["datasources_source:list:all"])).toEqual(["legacy", "sales"]);
    expect(await visible([])).toEqual([]);

    // Same filter for the resources that can be assigned to the callers of the tools
    const permissions = ["datasources_source:read:own", "datasources_source:use:own"];
    const assignable = await asUser({ id: alice, permissions }, (trx) => {
      return listResources(trx, datasourcesToolProvider.resource, { limit: 10 });
    });
    expect(assignable).toEqual([{ id: salesId, name: "sales" }]);
  });

  it("supports the same types of datasource in the browser and in the server", () => {
    const types = ["clickhouse", "mariadb", "postgres", "sqlserver"];
    expect(DatasourceTypes.map((type) => type.type)).toEqual(types);
    expect(datasourceTypes.map((type) => type.definition.type)).toEqual(types);
    expect(findDatasourceType("removed")).toBeUndefined();
  });

  it("provides a tool to query the assigned datasources", async () => {
    expect(collectToolProviders(features).map((provider) => provider.name)).toEqual(["datasources"]);

    const toolset = await datasourcesToolProvider.load(db, [salesId, legacyId, crypto.randomUUID()]);
    expect(toolset.tools.map((candidate) => candidate.name)).toEqual(["datasources_query"]);
    expect(toolset.documents).toEqual({ "sales.md": "Table `orders(id, total)`" });
    expect(toolset.instructions).toContain(`- "sales" (postgres)`);

    const tool = toolset.tools[0];
    expect(tool?.parameters.properties.datasource).toMatchObject({ enum: ["legacy", "sales"] });

    const args = { datasource: "sales", sql: "SELECT sum(total)::INT AS total FROM orders" };
    expect(await tool?.execute(args, context)).toBe(JSON.stringify([{ total: 30 }]));
    expect(tool?.describe?.(args)).toBe("```sql\nSELECT sum(total)::INT AS total FROM orders\n```");

    await expect(tool?.execute({ datasource: "sales", sql: "SELECT * FROM missing" }, context)).rejects.toThrow(
      /does not exist/,
    );
    await expect(tool?.execute({ datasource: "other", sql: "SELECT 1" }, context)).rejects.toThrow(/not found/);
    await expect(tool?.execute({ datasource: "legacy", sql: "SELECT 1" }, context)).rejects.toThrow(
      /Datasource type "removed" is not supported/,
    );
  });

  it("provides no tools without datasources", async () => {
    expect(await datasourcesToolProvider.load(db, [crypto.randomUUID()])).toEqual({ tools: [] });
  });
});
