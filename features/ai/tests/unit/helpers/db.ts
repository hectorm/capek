import type { Kysely } from "kysely";

import type { Database } from "#layers/core/shared/schema";
import aiFeature from "#layers/ai/server/feature";
import { createTestDb } from "#layers/core/tests/unit/helpers/db";

export { asUser, closeDb, isSuperuser } from "#layers/core/tests/unit/helpers/db";

export const createAiTestDb = (): Promise<Kysely<Database>> => createTestDb([aiFeature]);

export const insertAgent = async (db: Kysely<Database>, name: string): Promise<string> => {
  const row = await db
    .insertInto("aiAgents")
    .values({
      name,
      description: "",
      instructions: "",
      greetingMessage: "",
      priority: 0,
      type: "specialist",
      llmProviderId: null,
      model: "m",
      summaryModel: "",
      reasoningEffort: "",
      codeInterpreter: false,
      showToolCalls: true,
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

export const insertSkill = async (db: Kysely<Database>, name: string): Promise<string> => {
  const row = await db
    .insertInto("aiSkills")
    .values({ name, description: "", documentation: null, code: null })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return row.id;
};
