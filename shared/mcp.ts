import { z } from "zod/v4";

// prettier-ignore
export const MCPServerParameters = {
  toolCallTimeoutSec: { min: 1, max: 3600, step: 1, default: 60 },
} as const;

// prettier-ignore
export const MCPServerParametersSchema = z.object({
  toolCallTimeoutSec: z.number().int().min(MCPServerParameters.toolCallTimeoutSec.min).max(MCPServerParameters.toolCallTimeoutSec.max).nullish(),
});

export const MCPConfigSchema = z.record(
  z.string(),
  z.object({
    type: z.literal("http"),
    url: z.string(),
  }),
);

export type MCPConfig = z.infer<typeof MCPConfigSchema>;

export const MCPToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
  }),
});

export type MCPTool = z.infer<typeof MCPToolSchema>;

export const MCPListToolsResultSchema = z.object({
  tools: z.array(MCPToolSchema),
  nextCursor: z.string().nullish(),
});

export type MCPListToolsResult = z.infer<typeof MCPListToolsResultSchema>;

export const MCPCallToolResultSchema = z.object({
  content: z.array(
    z.object({
      type: z.literal("text"),
      text: z.string(),
    }),
  ),
  isError: z.boolean().optional(),
});

export type MCPCallToolResult = z.infer<typeof MCPCallToolResultSchema>;

export const McpPingRequestSchema = z.object({
  jsonrpc: z.literal("2.0").optional(),
  method: z.literal("ping"),
  id: z.union([z.string(), z.number()]),
});

export type McpPingRequest = z.infer<typeof McpPingRequestSchema>;
