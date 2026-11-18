import { z } from "zod/v4";

import type { Agent } from "#layers/ai/shared/schema";

export const allowsAgentTools = (
  agent: Pick<Agent, "type" | "codeInterpreter">,
  hasToolProviders: boolean,
): boolean => {
  return agent.type === "specialist" || (!agent.codeInterpreter && !hasToolProviders);
};

// prettier-ignore
export const AgentExecutorParameters = {
  temperature:                   { min: 0,    max: 2,          step: 0.1,       default: 1.0          },
  maxTokens:                     { min: 1,    max: 512000,     step: 1,         default: 8192         },
  topP:                          { min: 0,    max: 1,          step: 0.01,      default: 1.0          },
  frequencyPenalty:              { min: -2,   max: 2,          step: 0.1,       default: 0            },
  presencePenalty:               { min: -2,   max: 2,          step: 0.1,       default: 0            },
  maxIterations:                 { min: 1,    max: 1000,       step: 1,         default: 30           },
  timeoutSec:                    { min: 1,    max: 3600,       step: 1,         default: 600          },
  maxContextChars:               { min: 1000, max: 10000000,   step: 1000,      default: 500000       },
  maxToolResponseChars:          { min: 1000, max: 1000000,    step: 1000,      default: 100000       },
  maxToolPartsChars:             { min: 1000, max: 10000000,   step: 1000,      default: 1000000      },
} as const;

// prettier-ignore
export const AgentExecutorParametersSchema = z.object({
  temperature: z.number().min(AgentExecutorParameters.temperature.min).max(AgentExecutorParameters.temperature.max).nullish(),
  maxTokens: z.number().int().min(AgentExecutorParameters.maxTokens.min).max(AgentExecutorParameters.maxTokens.max).nullish(),
  topP: z.number().min(AgentExecutorParameters.topP.min).max(AgentExecutorParameters.topP.max).nullish(),
  frequencyPenalty: z.number().min(AgentExecutorParameters.frequencyPenalty.min).max(AgentExecutorParameters.frequencyPenalty.max).nullish(),
  presencePenalty: z.number().min(AgentExecutorParameters.presencePenalty.min).max(AgentExecutorParameters.presencePenalty.max).nullish(),
  maxIterations: z.number().int().min(AgentExecutorParameters.maxIterations.min).max(AgentExecutorParameters.maxIterations.max).nullish(),
  timeoutSec: z.number().int().min(AgentExecutorParameters.timeoutSec.min).max(AgentExecutorParameters.timeoutSec.max).nullish(),
  maxContextChars: z.number().int().min(AgentExecutorParameters.maxContextChars.min).max(AgentExecutorParameters.maxContextChars.max).nullish(),
  maxToolResponseChars: z.number().int().min(AgentExecutorParameters.maxToolResponseChars.min).max(AgentExecutorParameters.maxToolResponseChars.max).nullish(),
  maxToolPartsChars: z.number().int().min(AgentExecutorParameters.maxToolPartsChars.min).max(AgentExecutorParameters.maxToolPartsChars.max).nullish(),
});

export const AgentSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).trim(),
  instructions: z.string().max(100000).trim(),
  greetingMessage: z.string().max(10000).trim(),
  priority: z.number().int().min(-1000).max(1000),
  type: z.enum(["triage", "specialist"]),
  model: z.string().trim().min(1).max(100),
  summaryModel: z.string().max(100).trim(),
  reasoningEffort: z.string().max(20).trim(),
  codeInterpreter: z.boolean(),
  showToolCalls: z.boolean(),
  streaming: z.boolean(),
  ...AgentExecutorParametersSchema.shape,
});

// Partial updates must preserve omitted settings
export const NewAgentSettingsSchema = AgentSettingsSchema.extend({
  description: AgentSettingsSchema.shape.description.default(""),
  instructions: AgentSettingsSchema.shape.instructions.default(""),
  greetingMessage: AgentSettingsSchema.shape.greetingMessage.default(""),
  priority: AgentSettingsSchema.shape.priority.default(0),
  summaryModel: AgentSettingsSchema.shape.summaryModel.default(""),
  reasoningEffort: AgentSettingsSchema.shape.reasoningEffort.default(""),
  codeInterpreter: AgentSettingsSchema.shape.codeInterpreter.default(false),
  showToolCalls: AgentSettingsSchema.shape.showToolCalls.default(true),
  streaming: AgentSettingsSchema.shape.streaming.default(true),
});
