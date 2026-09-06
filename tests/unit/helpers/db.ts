import type { Kysely, Transaction } from "kysely";

import type { AuthUser } from "~~/server/lib/authn/strategies";
import type { Database } from "~~/shared/schema";
import { useDb, withUserTransaction } from "~~/server/lib/database";
import { migrateToLatest } from "~~/server/lib/database/migrator";

export { closeDb } from "~~/server/lib/database";
export { isSuperuser } from "~~/server/lib/database/rls";

export const createTestDb = async (): Promise<Kysely<Database>> => {
  const db = await useDb();
  await migrateToLatest(db);
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

export const insertAgent = async (db: Kysely<Database>, name: string): Promise<string> => {
  const row = await db
    .insertInto("agents")
    .values({
      name,
      description: "",
      instructions: "",
      greetingMessage: "",
      type: "specialist",
      llmProviderId: null,
      model: "m",
      summaryModel: "",
      codeInterpreter: false,
      streaming: true,
      temperature: null,
      maxTokens: null,
      topP: null,
      frequencyPenalty: null,
      presencePenalty: null,
      maxIterations: null,
      timeoutSec: null,
      maxContextChars: null,
      maxToolResponseChars: null,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return row.id;
};
