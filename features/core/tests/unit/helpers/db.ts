import type { Kysely, Transaction } from "kysely";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { ServerFeature } from "#layers/core/server/lib/features/define";
import type { Database } from "#layers/core/shared/schema";
import coreFeature from "#layers/core/server/feature";
import { useDb, withUserTransaction } from "#layers/core/server/lib/database";
import { migrateToLatest } from "#layers/core/server/lib/database/migrator";

export { closeDb } from "#layers/core/server/lib/database";
export { isSuperuser } from "#layers/core/server/lib/database/rls";

export const createTestDb = async (features: readonly ServerFeature[] = []): Promise<Kysely<Database>> => {
  const db = await useDb();
  await migrateToLatest(db, [coreFeature, ...features]);
  return db;
};

export interface TestPrincipal {
  id: string;
  groups?: string[];
  permissions?: string[];
}

export const asUser = <T>(
  principal: TestPrincipal,
  callback: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> => {
  const user = {
    id: principal.id,
    groups: principal.groups ?? [],
    permissions: principal.permissions ?? [],
  } as unknown as AuthUser;
  return withUserTransaction(user, callback);
};

// Users are named by the keys of the object and take its values as IDs, so `{ alice }` adds "alice"
export const insertUsers = async (db: Kysely<Database>, users: Record<string, string>): Promise<void> => {
  const rows = Object.entries(users).map(([username, id]) => {
    return { id, username, fullname: username, email: `${username}@example.com` };
  });
  await db.insertInto("users").values(rows).execute();
};
