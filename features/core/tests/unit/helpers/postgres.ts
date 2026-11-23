import process from "node:process";

import pg from "pg";
import { afterAll, vi } from "vitest";

import { runtimeConfig } from "#layers/core/tests/unit/helpers/nitro-config";

const url = new URL(process.env.TEST_DATABASE_URL ?? "");
if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
  throw new Error("TEST_DATABASE_URL requires a PostgreSQL URL");
}

const databaseName = `test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: url.href, max: 1, connectionTimeoutMillis: 2000 });
let creation: Promise<pg.QueryResult> | undefined;

url.pathname = `/${databaseName}`;
runtimeConfig.databaseUrl = url.href;

// Roles are shared across databases and the security tests change role attributes
vi.doMock("#layers/core/server/lib/database/rls", async (importOriginal) => {
  const rls = await importOriginal<typeof import("#layers/core/server/lib/database/rls")>();
  return { ...rls, FALLBACK_ROLE: databaseName };
});

export const createPostgresDatabase = async (): Promise<void> => {
  creation ??= admin.query(`CREATE DATABASE ${databaseName}`).catch((error: unknown) => {
    creation = undefined;
    throw error;
  });
  await creation;
};

afterAll(async () => {
  try {
    if (creation) {
      await creation;
      await admin.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${databaseName}`);
    }
  } finally {
    await admin.end();
  }
});
