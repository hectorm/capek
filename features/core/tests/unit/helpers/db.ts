import type { AnyRouter } from "@trpc/server";
import type { Kysely, Transaction } from "kysely";
import { z } from "zod/v4";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { ServerFeature } from "#layers/core/server/lib/features/define";
import type { SeedDefinition } from "#layers/core/server/lib/seed";
import type { PermissionName } from "#layers/core/shared/rbac";
import type { Database } from "#layers/core/shared/schema";
import coreFeature from "#layers/core/server/feature";
import { useDb, withUserTransaction } from "#layers/core/server/lib/database";
import { migrateToLatest } from "#layers/core/server/lib/database/migrator";
import { useLogger } from "#layers/core/server/lib/logger";
import { loadEncryptionKeys } from "#layers/core/server/lib/secrets";
import { createSeedContext } from "#layers/core/server/lib/seed";

export { closeDb } from "#layers/core/server/lib/database";
export { isSuperuser } from "#layers/core/server/lib/database/rls";

export const createTestDb = async (features: readonly ServerFeature[] = []): Promise<Kysely<Database>> => {
  const db = await useDb();
  await migrateToLatest(db, [coreFeature, ...features]);
  await loadEncryptionKeys();
  return db;
};

export interface TestPrincipal {
  id: string;
  username?: string;
  groups?: string[];
  permissions?: PermissionName[];
}

export const authUser = (principal: TestPrincipal): AuthUser & Required<TestPrincipal> => {
  const username = principal.username ?? principal.id;
  return {
    id: principal.id,
    username,
    fullname: username,
    email: `${username}@example.com`,
    picture: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    groups: principal.groups ?? [],
    permissions: principal.permissions ?? [],
  };
};

export const asUser = <T>(
  principal: TestPrincipal,
  callback: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> => {
  return withUserTransaction(authUser(principal), callback);
};

export const createTestCaller = <TRouter extends AnyRouter>(
  router: TRouter,
  principal: TestPrincipal | null,
): ReturnType<TRouter["createCaller"]> => {
  return router.createCaller({
    logger: useLogger(),
    user: principal && authUser(principal),
  }) as ReturnType<TRouter["createCaller"]>;
};

// `{ alice }` adds a user named "alice" whose ID is the value of `alice`
export const insertUsers = async (db: Kysely<Database>, users: Record<string, string>): Promise<void> => {
  const rows = Object.entries(users).map(([username, id]) => {
    return { id, username, fullname: username, email: `${username}@example.com` };
  });
  await db.insertInto("users").values(rows).execute();
};

// Runs the seed of a feature with its section of the configuration
export const runSeed = async <S extends z.ZodRawShape>(
  db: Kysely<Database>,
  features: readonly ServerFeature[],
  seed: SeedDefinition<S>,
  config: unknown,
): Promise<void> => {
  const deferred: (() => Promise<void>)[] = [];
  const ctx = createSeedContext(db, useLogger(), features, (fn) => deferred.push(fn));
  await seed.run(z.object(seed.schema).parse(config), ctx);
  for (const fn of deferred) {
    await fn();
  }
};
