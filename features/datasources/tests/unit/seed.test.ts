import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "#layers/core/shared/schema";
import coreFeature from "#layers/core/server/feature";
import { closeDb, createTestDb, insertUsers, runSeed } from "#layers/core/tests/unit/helpers/db";
import datasourcesFeature from "#layers/datasources/server/feature";
import { datasourcesSeed } from "#layers/datasources/server/seed";

let db: Kysely<Database>;

const alice = crypto.randomUUID();

beforeAll(async () => {
  db = await createTestDb([datasourcesFeature]);
  await insertUsers(db, { alice });
});

afterAll(async () => {
  await closeDb();
});

describe("datasources seed", () => {
  it("creates the sources with their access once", async () => {
    const config = {
      sources: [
        {
          name: "sales",
          type: "postgres",
          config: { connectionString: "postgres://db.example.com:5432/sales", authType: "none" },
          access: { users: { users: ["alice"] } },
        },
      ],
    };
    const features = [coreFeature, datasourcesFeature];
    await runSeed(db, features, datasourcesSeed, config);
    await runSeed(db, features, datasourcesSeed, config);

    const sources = await db
      .selectFrom("datasourcesSources")
      .innerJoin("datasourcesSourceAccess", "datasourcesSourceAccess.sourceId", "datasourcesSources.id")
      .select(["datasourcesSources.name", "datasourcesSourceAccess.userId", "datasourcesSourceAccess.role"])
      .execute();
    expect(sources).toEqual([{ name: "sales", userId: alice, role: "user" }]);

    await expect(
      runSeed(db, features, datasourcesSeed, { sources: [{ ...config.sources[0], name: "legacy", type: "removed" }] }),
    ).rejects.toThrow('Datasource type "removed" of "legacy" is not supported');
  });
});
