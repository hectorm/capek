import type { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ToolContext } from "#layers/ai/server/lib/tools/define";
import type { ToolPart } from "#layers/ai/shared/tools";
import type { Database } from "#layers/core/shared/schema";
import { collectToolProviders } from "#layers/ai/server/lib/tools/define";
import coreFeature from "#layers/core/server/feature";
import { closeDb, createTestDb, insertUsers } from "#layers/core/tests/unit/helpers/db";
import { runtimeConfig } from "#layers/core/tests/unit/helpers/nitro-config";
import datasourcesFeature from "#layers/datasources/server/feature";
import { datasourcesToolProvider } from "#layers/datasources/server/integrations/ai";
import { encryptSourceConfig } from "#layers/datasources/server/lib/secrets";

let db: Kysely<Database>;

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
  Object.assign(runtimeConfig, { allowedPrivateHosts: salesServer.getServerConn() });

  db = await createTestDb([datasourcesFeature]);

  await insertUsers(db, { alice });
  await db
    .insertInto("datasourcesSources")
    .values([
      {
        id: salesId,
        name: "sales",
        description: "",
        documentation: "Table `orders(id, total)`",
        type: "postgres",
        config: encryptSourceConfig({
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
        config: encryptSourceConfig({}),
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

const loadQueryTool = async () => {
  const [tool] = (await datasourcesToolProvider.load(db, [salesId, legacyId])).tools;
  if (!tool) {
    throw new Error("Query tool not found");
  }
  return tool;
};

describe("datasource tool", () => {
  it("is loaded for the assigned datasources", async () => {
    expect(collectToolProviders(features).map((provider) => provider.name)).toEqual(["datasources"]);

    const toolset = await datasourcesToolProvider.load(db, [salesId, legacyId, crypto.randomUUID()]);
    expect(toolset.tools.map((candidate) => candidate.name)).toEqual(["datasources_query"]);
    expect(toolset.documents).toEqual({ "sales.md": "Table `orders(id, total)`" });
    expect(toolset.instructions).toContain(`- "sales" (postgres)`);
    expect(toolset.tools[0]?.parameters.properties.datasource).toMatchObject({ enum: ["legacy", "sales"] });

    expect(await datasourcesToolProvider.load(db, [crypto.randomUUID()])).toEqual({ tools: [] });
  });

  it("returns the rows of a query and whether they were cut", async () => {
    const tool = await loadQueryTool();

    const sum = { datasource: "sales", sql: "SELECT sum(total)::INT AS total FROM orders" };
    expect(await tool.execute(sum, context)).toBe(JSON.stringify({ rows: [{ total: 30 }], truncated: false }));
    expect(tool.describe?.(sum)).toBe("```sql\nSELECT sum(total)::INT AS total FROM orders\n```");

    const series = { datasource: "sales", sql: "SELECT generate_series(1, 101) AS id" };
    const rows = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
    expect(await tool.execute(series, context)).toBe(JSON.stringify({ rows, truncated: true }));
  });

  it("shows the rows of a query as a table", async () => {
    const tool = await loadQueryTool();
    const parts: ToolPart[] = [];
    const show = (part: ToolPart) => parts.push(part);

    const series = { datasource: "sales", sql: "SELECT generate_series(1, 101) AS id", show: true };
    expect(await tool.execute({ ...series, name: "Series" }, { ...context, show })).toBe(
      JSON.stringify({ shown: 101, truncated: false }),
    );
    expect(parts).toEqual([
      { type: "table", name: "Series", columns: ["id"], rows: Array.from({ length: 101 }, (_, index) => [index + 1]) },
    ]);
    await expect(tool.execute(series, { ...context, show })).rejects.toThrow("Missing required 'name' field");
  });

  it("rejects the queries of missing or unsupported datasources", async () => {
    const tool = await loadQueryTool();

    await expect(tool.execute({ datasource: "other", sql: "SELECT 1" }, context)).rejects.toThrow(/not found/);
    await expect(tool.execute({ datasource: "legacy", sql: "SELECT 1" }, context)).rejects.toThrow(
      /Datasource type "removed" is not supported/,
    );
  });
});
