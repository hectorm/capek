import { z } from "zod/v4";

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
});
