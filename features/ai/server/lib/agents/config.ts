import type { InferResult, Kysely } from "kysely";

import type { Database } from "#layers/core/shared/schema";
import { decryptLlmProviderSecrets } from "#layers/ai/server/lib/secrets";
import { AgentExecutorParameters } from "#layers/ai/shared/agent";
import { useDb } from "#layers/core/server/lib/database";

const selectAgents = (db: Kysely<Database>) => {
  return db
    .selectFrom("aiAgents")
    .innerJoin("aiLlmProviders", "aiLlmProviders.id", "aiAgents.llmProviderId")
    .select([
      "aiAgents.id",
      "aiAgents.name",
      "aiAgents.description",
      "aiAgents.instructions",
      "aiAgents.type",
      "aiAgents.model",
      "aiAgents.summaryModel",
      "aiAgents.reasoningEffort",
      "aiAgents.codeInterpreter",
      "aiAgents.showToolCalls",
      "aiAgents.streaming",
      "aiAgents.temperature",
      "aiAgents.maxTokens",
      "aiAgents.topP",
      "aiAgents.frequencyPenalty",
      "aiAgents.presencePenalty",
      "aiAgents.maxIterations",
      "aiAgents.timeoutSec",
      "aiAgents.maxContextChars",
      "aiAgents.maxToolResponseChars",
      "aiAgents.maxToolPartsChars",
      "aiLlmProviders.apiUrl",
      "aiLlmProviders.apiType",
      "aiLlmProviders.apiKey",
      "aiLlmProviders.headers",
    ]);
};

type StoredAgentConfig = InferResult<ReturnType<typeof selectAgents>>[number];

const toAgentConfig = (agent: StoredAgentConfig) => ({
  ...agent,
  ...decryptLlmProviderSecrets(agent),
  maxIterations: agent.maxIterations ?? AgentExecutorParameters.maxIterations.default,
  timeoutSec: agent.timeoutSec ?? AgentExecutorParameters.timeoutSec.default,
  maxContextChars: agent.maxContextChars ?? AgentExecutorParameters.maxContextChars.default,
  maxToolResponseChars: agent.maxToolResponseChars ?? AgentExecutorParameters.maxToolResponseChars.default,
  maxToolPartsChars: agent.maxToolPartsChars ?? AgentExecutorParameters.maxToolPartsChars.default,
});

export type AgentConfig = ReturnType<typeof toAgentConfig>;

export const loadAgent = async (agentId: string): Promise<AgentConfig> => {
  const db = await useDb();
  const agent = await selectAgents(db).where("aiAgents.id", "=", agentId).executeTakeFirst();
  if (!agent) {
    throw new Error(`Agent ${agentId} not found or has no LLM provider assigned`);
  }
  return toAgentConfig(agent);
};

export const loadTriageSpecialists = async (triageAgentId: string): Promise<AgentConfig[]> => {
  const db = await useDb();
  const agents = await selectAgents(db)
    .innerJoin("aiTriageSpecialists", "aiTriageSpecialists.specialistAgentId", "aiAgents.id")
    .where("aiTriageSpecialists.triageAgentId", "=", triageAgentId)
    .execute();
  return agents.map(toAgentConfig);
};
