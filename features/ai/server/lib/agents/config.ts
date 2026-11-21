import type { Kysely, SelectQueryBuilder } from "kysely";

import type { Agent, LlmProvider } from "#layers/ai/shared/schema";
import type { HttpHeader } from "#layers/core/shared/http";
import type { Database } from "#layers/core/shared/schema";
import { decryptLlmProviderSecrets } from "#layers/ai/server/lib/secrets";
import { AgentExecutorParameters } from "#layers/ai/shared/agent";
import { useDb } from "#layers/core/server/lib/database";

type StoredAgentConfig = Pick<
  Agent,
  | "id"
  | "name"
  | "description"
  | "instructions"
  | "type"
  | "model"
  | "summaryModel"
  | "reasoningEffort"
  | "codeInterpreter"
  | "showToolCalls"
  | "streaming"
  | "temperature"
  | "maxTokens"
  | "topP"
  | "frequencyPenalty"
  | "presencePenalty"
  | "maxIterations"
  | "timeoutSec"
  | "maxContextChars"
  | "maxToolResponseChars"
  | "maxToolPartsChars"
> &
  Pick<LlmProvider, "apiUrl" | "apiType" | "apiKey" | "headers">;

// The limits of an agent fall back to their defaults
export type AgentConfig = Omit<
  StoredAgentConfig,
  "headers" | "maxIterations" | "timeoutSec" | "maxContextChars" | "maxToolResponseChars" | "maxToolPartsChars"
> & {
  headers: HttpHeader[];
  maxIterations: number;
  timeoutSec: number;
  maxContextChars: number;
  maxToolResponseChars: number;
  maxToolPartsChars: number;
};

const selectAgents = (
  db: Kysely<Database>,
): SelectQueryBuilder<Database, "aiAgents" | "aiLlmProviders", StoredAgentConfig> => {
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

const toAgentConfig = (agent: StoredAgentConfig): AgentConfig => ({
  ...agent,
  ...decryptLlmProviderSecrets(agent),
  maxIterations: agent.maxIterations ?? AgentExecutorParameters.maxIterations.default,
  timeoutSec: agent.timeoutSec ?? AgentExecutorParameters.timeoutSec.default,
  maxContextChars: agent.maxContextChars ?? AgentExecutorParameters.maxContextChars.default,
  maxToolResponseChars: agent.maxToolResponseChars ?? AgentExecutorParameters.maxToolResponseChars.default,
  maxToolPartsChars: agent.maxToolPartsChars ?? AgentExecutorParameters.maxToolPartsChars.default,
});

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
