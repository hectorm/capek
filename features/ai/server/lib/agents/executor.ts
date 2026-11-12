import { clearInterval, setInterval } from "node:timers";

import type { Kysely } from "kysely";
import superjson from "superjson";
import { z } from "zod/v4";

import type { MCPServerBinding, SkillBinding } from "#layers/ai/server/lib/code/generators";
import type { MCPServerInfo } from "#layers/ai/server/lib/mcp/tools";
import type { AgentToolset } from "#layers/ai/server/lib/tools";
import type { ChatMessagePart } from "#layers/ai/shared/chat";
import type { LlmIncompleteDetails, LlmItem, LlmTool } from "#layers/ai/shared/llm";
import type { LlmProviderApiType } from "#layers/ai/shared/llmProvider";
import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { SharedResource } from "#layers/core/server/lib/authz/resources";
import type { PageCursor } from "#layers/core/server/lib/database/pagination";
import type { Tool } from "#layers/core/server/lib/tools/define";
import type { HttpHeader } from "#layers/core/shared/http";
import type { Database } from "#layers/core/shared/schema";
import type { ToolPart } from "#layers/core/shared/tools";
import {
  buildCodeInterpreterPrompt,
  buildSkillToolsPrompt,
  buildToolsetsPrompt,
  buildTriagePrompt,
} from "#layers/ai/server/lib/agents/prompts";
import { createVFS, uniqueIds } from "#layers/ai/server/lib/code/generators";
import { executeCode } from "#layers/ai/server/lib/code/interpreter";
import { loadSessionWorkspace, saveSessionWorkspace } from "#layers/ai/server/lib/code/persistence";
import { formatConsoleLog } from "#layers/ai/server/lib/code/protocol";
import {
  AbortError,
  ConcurrentExecutionError,
  MaxIterationsError,
  MaxOutputTokensError,
  RefusalError,
  TimeoutError,
} from "#layers/ai/server/lib/errors";
import { LlmClient } from "#layers/ai/server/lib/llm/client";
import { MCPManager } from "#layers/ai/server/lib/mcp/manager";
import { ensureToolsDiscovered } from "#layers/ai/server/lib/mcp/tools";
import { McpServerResource, SkillResource } from "#layers/ai/server/lib/resources";
import { loadAgentToolsets, truncate } from "#layers/ai/server/lib/tools";
import { AgentExecutorParameters } from "#layers/ai/shared/agent";
import { ChatStreamEvents } from "#layers/ai/shared/chat";
import { LlmItemSchema } from "#layers/ai/shared/llm";
import { MCPToolSchema } from "#layers/ai/shared/mcp";
import { OpenAIFunctionParametersSchema } from "#layers/ai/shared/openai";
import { usableResourceIds } from "#layers/core/server/lib/authz/resources";
import { useDb, withUserTransaction } from "#layers/core/server/lib/database";
import { isUniqueViolation } from "#layers/core/server/lib/database/errors";
import { paginate } from "#layers/core/server/lib/database/pagination";
import { useLogger } from "#layers/core/server/lib/logger";
import { getToolProviders } from "#layers/core/server/lib/tools";

const logger = useLogger();

const streamEncoder = new TextEncoder();

const encodeStreamEvent = (event: string, data: string | ChatMessagePart): Uint8Array => {
  return streamEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

interface AgentExecutorConfig {
  sessionId: string;
  user: AuthUser;
  message: string;
}

interface AgentConfig {
  id: string;
  name: string;
  description: string;
  instructions: string;
  type: "triage" | "specialist";
  model: string;
  summaryModel: string | null;
  reasoningEffort: string;
  codeInterpreter: boolean;
  showToolCalls: boolean;
  streaming: boolean;
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
  presencePenalty: number | null;
  maxIterations: number;
  timeoutSec: number;
  maxContextChars: number;
  maxToolResponseChars: number;
  maxToolPartsChars: number;
  llmProviderId: string;
  apiUrl: string;
  apiType: LlmProviderApiType;
  apiKey: string;
  headers: HttpHeader[];
}

interface AgentTool {
  tool: Tool;
  mcpServerId?: string;
  skillId?: string;
  toolProvider?: string;
}

type LlmFunctionCall = Extract<LlmItem, { type: "function_call" }>;

interface ExecutionOutcome {
  status: "completed" | "failed" | "cancelled";
  errorMessage?: string;
}

const TOOL_NAME_MAX_LENGTH = 64;

const CODE_MAX_MEMORY_BYTES = 25 * 1024 * 1024;
const CODE_MAX_WORKSPACE_BYTES = 10 * 1024 * 1024;

const CONTEXT_PAGE_SIZE = 50;
const CONTEXT_MAX_MESSAGES = 2000;

const EXECUTION_HEARTBEAT_MS = 30_000;
const EXECUTION_STALE_MS = 4 * EXECUTION_HEARTBEAT_MS;

const triageToolSchema = z.object({
  specialistId: z.string(),
  routingReason: z.string(),
});

const assertComplete = (incomplete: LlmIncompleteDetails | undefined): void => {
  if (incomplete?.reason === "content_filter") {
    throw new RefusalError(incomplete.message);
  }
  if (incomplete?.reason === "max_output_tokens") {
    throw new MaxOutputTokensError();
  }
};

const serialize = (value: unknown, maxChars: number): string => {
  const json = superjson.stringify(value);
  return json.length > maxChars ? superjson.stringify(truncate(json, maxChars)) : json;
};

const countChars = (items: LlmItem[]): number => {
  return items.reduce((total, item) => {
    switch (item.type) {
      case "message":
        return total + item.content.length;
      case "reasoning":
        return total;
      case "function_call":
        return total + item.arguments.length;
      case "function_call_output":
        return total + item.output.length;
    }
  }, 0);
};

export class AgentExecutor {
  private readonly config: AgentExecutorConfig;
  private executionId: string | null = null;
  private iterationCount = 0;
  private partsChars = 0;
  private readonly startedAt: Date;

  public constructor(config: AgentExecutorConfig) {
    this.config = config;
    this.startedAt = new Date();
  }

  public async createExecution(agentId: string): Promise<string> {
    try {
      return await withUserTransaction(this.config.user, async (trx) => {
        const userMessage = await trx
          .insertInto("aiChatMessages")
          .values({
            sessionId: this.config.sessionId,
            role: "user",
            content: this.config.message,
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        const execution = await trx
          .insertInto("aiAgentExecutions")
          .values({
            sessionId: this.config.sessionId,
            agentId,
            userId: this.config.user.id,
            status: "running",
            inputMessageId: userMessage.id,
            startedAt: this.startedAt,
            lastActivityAt: this.startedAt,
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        this.executionId = execution.id;
        return execution.id;
      });
    } catch (error) {
      if (
        isUniqueViolation(error) &&
        (error as { constraint?: string }).constraint === "ai_agent_executions_session_running_uniq_idx"
      ) {
        throw new ConcurrentExecutionError();
      }
      throw error;
    }
  }

  public async *executeStream(agentId: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    const heartbeat = setInterval(() => {
      this.updateLastActivity().catch((error: unknown) => {
        logger.warn({ executionId: this.executionId, error }, "Failed to report the activity of the execution");
      });
    }, EXECUTION_HEARTBEAT_MS);

    let outcome: ExecutionOutcome = { status: "cancelled", errorMessage: new AbortError().message };
    try {
      if (!this.executionId) {
        await this.createExecution(agentId);
      }

      const agent = await this.loadAgent(agentId);

      if (agent.type === "triage") {
        yield* this.executeTriageStream(agent, signal);
      } else {
        yield* this.executeSpecialistStream(agent, signal);
      }

      outcome = { status: "completed" };
    } catch (caught) {
      const error = caught instanceof DOMException && caught.name === "TimeoutError" ? new TimeoutError() : caught;
      const cancelled =
        signal?.aborted === true ||
        error instanceof AbortError ||
        error instanceof TimeoutError ||
        error instanceof MaxIterationsError;
      outcome = {
        status: cancelled ? "cancelled" : "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      throw error;
    } finally {
      clearInterval(heartbeat);
      await this.completeExecution(outcome);
    }
  }

  private async *executeTriageStream(agent: AgentConfig, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    const specialists = await this.loadTriageSpecialists(agent.id);

    if (specialists.length === 0) {
      throw new Error("No specialists assigned to this triage agent");
    }

    const triageInstructions = buildTriagePrompt(agent.instructions, specialists);

    const tools: LlmTool[] = [
      {
        type: "function",
        name: "route_to_specialist",
        description: "Route the user's request to the most appropriate specialist agent",
        parameters: {
          type: "object",
          properties: {
            specialistId: {
              type: "string",
              enum: specialists.map((s) => s.id),
              description: "The ID of the specialist to route to",
            },
            routingReason: {
              type: "string",
              description: [
                "A short, friendly message shown to the user explaining the routing decision.",
                "IMPORTANT: Write this message in the same language the user is using.",
                "Example (English): 'Routing to SQL Analyst to help with your query'",
                "Example (Spanish): 'Redirigiendo al Analista SQL para ayudarte con tu consulta'",
              ].join("\n"),
            },
          },
          required: ["specialistId", "routingReason"],
        },
      },
    ];

    // The tools are called by the specialists, so only what was said matters to choose one
    const context = await this.buildContext(agent, { toolCalls: false });
    const items: LlmItem[] = [{ type: "message", role: "system", content: triageInstructions }, ...context];

    const llmClient = this.createLlmClient(agent);
    const completion = await llmClient.completion(
      {
        input: items,
        model: agent.model,
        reasoning: agent.reasoningEffort ? { effort: agent.reasoningEffort } : undefined,
        temperature: agent.temperature ?? undefined,
        max_output_tokens: agent.maxTokens ?? undefined,
        top_p: agent.topP ?? undefined,
        frequency_penalty: agent.frequencyPenalty ?? undefined,
        presence_penalty: agent.presencePenalty ?? undefined,
        tools,
        stream: false,
      },
      this.withTimeout(agent, signal),
    );

    if (completion instanceof ReadableStream) {
      throw new Error("Streaming not supported for triage agent");
    }

    assertComplete(completion.incomplete_details);

    const functionCall = completion.output.find((item) => item.type === "function_call");
    if (!functionCall) {
      throw new Error("Triage agent failed to select a specialist");
    }

    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(functionCall.arguments);
    } catch {
      throw new Error("Triage agent returned invalid JSON for tool arguments");
    }
    const args = triageToolSchema.parse(rawArgs);

    const specialist = specialists.find((s) => s.id === args.specialistId);
    if (!specialist) {
      throw new Error(`Selected specialist "${args.specialistId}" not found`);
    }

    yield encodeStreamEvent(ChatStreamEvents.Status, args.routingReason);

    yield* this.executeSpecialistStream(specialist, signal);
  }

  private async *executeSpecialistStream(agent: AgentConfig, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    const db = await useDb();
    const mcpServers = await this.loadAgentMCPServers(agent.id);

    for (const server of mcpServers) {
      if (server.cachedTools.length === 0) {
        try {
          server.cachedTools = await ensureToolsDiscovered(db, server.id);
        } catch (error) {
          logger.error({ mcpServerId: server.id, serverName: server.name, error }, "Failed to discover MCP tools");
        }
      }
    }

    const mcpServerBindings: MCPServerBinding[] = mcpServers.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      headers: s.headers,
      stateful: s.stateful,
      toolCallTimeoutSec: s.toolCallTimeoutSec,
      tools: s.cachedTools,
    }));

    const skillBindings: SkillBinding[] = agent.type === "specialist" ? await this.loadAgentSkills(agent.id) : [];
    const toolsets: AgentToolset[] =
      agent.type === "specialist" ? await loadAgentToolsets(db, getToolProviders(), agent.id, this.config.user) : [];

    let systemInstructions = agent.instructions;
    let tools: AgentTool[];

    if (agent.codeInterpreter && agent.type === "specialist") {
      systemInstructions = [
        agent.instructions,
        "",
        buildCodeInterpreterPrompt({ toolProviders: toolsets.map((toolset) => toolset.provider) }),
      ].join("\n");

      tools = [this.createCodeTool(agent, mcpServerBindings, skillBindings, toolsets)];
    } else {
      const mcpTools = mcpServers.flatMap((server) => this.createMcpTools(server));

      const executableSkills = skillBindings.filter((s) => s.code !== null);
      const skillTools = executableSkills.map((skill) => this.createSkillTool(agent, skill, mcpServerBindings));

      const featureTools = toolsets.flatMap((toolset) => {
        return toolset.tools.map((tool) => ({ tool, toolProvider: toolset.provider }));
      });

      const toolName = uniqueIds(TOOL_NAME_MAX_LENGTH);
      tools = [...featureTools, ...skillTools, ...mcpTools].map((agentTool) => ({
        ...agentTool,
        tool: { ...agentTool.tool, name: toolName(agentTool.tool.name) },
      }));

      if (executableSkills.length > 0) {
        systemInstructions = [systemInstructions, "", buildSkillToolsPrompt()].join("\n");
      }

      const toolsetsPrompt = buildToolsetsPrompt(toolsets);
      if (toolsetsPrompt) {
        systemInstructions = [systemInstructions, "", toolsetsPrompt].join("\n");
      }
    }

    const functionTools: LlmTool[] = tools.map(({ tool }) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));

    const context = await this.buildContext(agent, { toolCalls: true });
    const items: LlmItem[] = [{ type: "message", role: "system", content: systemInstructions }, ...context];
    const contextLength = items.length;

    const llmClient = this.createLlmClient(agent);

    let completed = false;

    try {
      while (this.iterationCount < agent.maxIterations) {
        if (!this.checkTimeout(agent)) {
          throw new TimeoutError();
        }

        this.iterationCount++;

        const completion = await llmClient.completion(
          {
            input: items,
            model: agent.model,
            reasoning: agent.reasoningEffort ? { effort: agent.reasoningEffort } : undefined,
            temperature: agent.temperature ?? undefined,
            max_output_tokens: agent.maxTokens ?? undefined,
            top_p: agent.topP ?? undefined,
            frequency_penalty: agent.frequencyPenalty ?? undefined,
            presence_penalty: agent.presencePenalty ?? undefined,
            tools: functionTools.length > 0 ? functionTools : undefined,
          },
          this.withTimeout(agent, signal),
        );

        let output: LlmItem[] = [];
        let incomplete: LlmIncompleteDetails | undefined;

        if (completion instanceof ReadableStream) {
          const reader = completion.getReader();
          let text = "";

          try {
            while (!signal?.aborted) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }

              if (value.type === "response.output_text.delta") {
                text += value.delta;
                yield encodeStreamEvent(ChatStreamEvents.Token, value.delta);
              } else {
                output = value.response.output;
                incomplete = value.response.incomplete_details;
              }
            }
          } finally {
            reader.releaseLock();
            // A stream that stops before its response is complete leaves the text that it sent
            if (output.length === 0 && text) {
              output = [{ type: "message", role: "assistant", content: text }];
            }
            items.push(...output);
          }
        } else {
          output = completion.output;
          incomplete = completion.incomplete_details;
          items.push(...output);

          for (const item of output) {
            if (item.type === "message") {
              yield encodeStreamEvent(ChatStreamEvents.Token, item.content);
            }
          }
        }

        assertComplete(incomplete);

        const functionCalls = output.filter((item) => item.type === "function_call");
        if (functionCalls.length === 0) {
          completed = true;
          break;
        }

        yield* this.handleToolCalls(functionCalls, tools, items, agent, signal);
      }
    } finally {
      // Yielding here would stop a stream closed by its consumer before the answer is saved
      try {
        await this.saveAssistantMessage(items.slice(contextLength));
      } catch (error) {
        logger.error({ executionId: this.executionId, error }, "Failed to persist streamed answer");
      }
    }

    if (!completed) {
      throw new MaxIterationsError();
    }
  }

  private async *handleToolCalls(
    functionCalls: LlmFunctionCall[],
    tools: AgentTool[],
    items: LlmItem[],
    agent: AgentConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<Uint8Array> {
    for (const functionCall of functionCalls) {
      yield* this.handleToolCall(functionCall, tools, items, agent, signal);
    }

    yield encodeStreamEvent(ChatStreamEvents.Status, "");
  }

  private async *handleToolCall(
    functionCall: LlmFunctionCall,
    tools: AgentTool[],
    items: LlmItem[],
    agent: AgentConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<Uint8Array> {
    const toolName = functionCall.name;
    const agentTool = tools.find((candidate) => candidate.tool.name === toolName);

    if (!agentTool) {
      const errorMessage = `Tool "${toolName}" not found`;
      logger.error({ toolName, executionId: this.executionId }, errorMessage);
      await this.saveToolCall(functionCall, null, null, errorMessage);
      items.push({ type: "function_call_output", call_id: functionCall.call_id, output: `Error: ${errorMessage}` });
      return;
    }

    let args: Record<string, unknown>;
    try {
      const raw: unknown = JSON.parse(functionCall.arguments);
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("Tool arguments must be a JSON object");
      }
      args = raw as Record<string, unknown>;
    } catch (parseError) {
      const errorMessage = `Failed to parse tool arguments: ${functionCall.arguments}`;
      logger.error({ toolName, executionId: this.executionId, parseError }, errorMessage);
      await this.saveToolCall(functionCall, agentTool, null, errorMessage);
      items.push({ type: "function_call_output", call_id: functionCall.call_id, output: `Error: ${errorMessage}` });
      return;
    }

    yield encodeStreamEvent(ChatStreamEvents.Status, toolName);

    functionCall.description = agent.showToolCalls ? agentTool.tool.describe?.(args) : undefined;
    if (functionCall.description) {
      yield encodeStreamEvent(ChatStreamEvents.Part, {
        type: "tool",
        id: functionCall.call_id,
        name: toolName,
        description: functionCall.description,
      });
    }

    const parts: ToolPart[] = [];
    let partsChars = this.partsChars;
    const show = (part: ToolPart): void => {
      const chars = JSON.stringify(part).length;
      if (partsChars + chars > agent.maxToolPartsChars) {
        throw new Error(
          `The tool calls of an answer cannot show the user more than ${String(agent.maxToolPartsChars)} characters, reduce the data of what is shown`,
        );
      }
      partsChars += chars;
      parts.push(part);
    };

    try {
      const response = await agentTool.tool.execute(args, {
        user: this.config.user,
        signal: this.withTimeout(agent, signal),
        show,
      });

      const result = truncate(response, agent.maxToolResponseChars);
      if (result !== response) {
        logger.debug({ toolName, originalLength: response.length }, "Tool response truncated");
      }

      await this.saveToolCall(functionCall, agentTool, result, null);

      items.push({ type: "function_call_output", call_id: functionCall.call_id, output: result });

      if (parts.length > 0) {
        functionCall.parts = parts;
        this.partsChars = partsChars;
        for (const part of parts) {
          yield encodeStreamEvent(ChatStreamEvents.Part, part);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ toolName, executionId: this.executionId, error: errorMessage }, "Tool execution failed");

      await this.saveToolCall(functionCall, agentTool, null, errorMessage);

      items.push({ type: "function_call_output", call_id: functionCall.call_id, output: `Error: ${errorMessage}` });
    }
  }

  private createCodeTool(
    agent: AgentConfig,
    mcpServerBindings: MCPServerBinding[],
    skillBindings: SkillBinding[],
    toolsets: AgentToolset[],
  ): AgentTool {
    return {
      tool: {
        name: "execute_code",
        description: [
          "Execute JavaScript code in a sandboxed environment with access to MCP server APIs.",
          "Use this to perform complex operations, process data, or call multiple APIs.",
        ].join("\n"),
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: [
                "JavaScript code to execute.",
                "MUST include a return statement to return the final result.",
              ].join("\n"),
            },
            reasoning: {
              type: "string",
              description: "Brief explanation of what the code does (optional).",
            },
          },
          required: ["code"],
        },
        execute: async (args, context) => {
          if (typeof args.code !== "string") {
            throw new Error("Missing required 'code' field");
          }

          logger.debug(
            { executionId: this.executionId, codeLength: args.code.length },
            "Executing code in interpreter",
          );

          const vfs = createVFS(mcpServerBindings, skillBindings, toolsets);

          await loadSessionWorkspace(vfs, this.config.sessionId, context.user);

          const executionResult = await executeCode(args.code, {
            chatSessionId: this.config.sessionId,
            vfs,
            mcpServers: mcpServerBindings,
            tools: { toolsets, context },
            maxExecutionMs: agent.timeoutSec * 1000,
            maxMemoryBytes: CODE_MAX_MEMORY_BYTES,
            maxWorkspaceBytes: CODE_MAX_WORKSPACE_BYTES,
            maxCallLogChars: agent.maxToolResponseChars,
            signal: context.signal,
          });

          await saveSessionWorkspace(vfs, this.config.sessionId, context.user);

          const codeExecutionId = await this.saveCodeExecution(
            agent,
            args.code,
            typeof args.reasoning === "string" ? args.reasoning : null,
            executionResult.result,
            executionResult.consoleLogs,
            executionResult.error,
            executionResult.executionMs,
          );

          for (const mcpCall of executionResult.mcpCallLogs) {
            const server = mcpServerBindings.find((s) => s.name === mcpCall.serverName);
            await this.saveToolCallFromCodeExecution(
              codeExecutionId,
              server?.id ?? null,
              mcpCall.toolName,
              mcpCall.args,
              mcpCall.result,
              mcpCall.error,
            );
          }

          for (const toolCallLog of executionResult.toolCallLogs) {
            await this.saveToolCallFromCodeExecution(
              codeExecutionId,
              null,
              toolCallLog.toolName,
              toolCallLog.args,
              toolCallLog.result,
              toolCallLog.error,
              toolCallLog.provider,
            );
          }

          if (executionResult.error) {
            throw new Error(executionResult.error);
          }

          const parts: string[] = [];

          if (executionResult.result !== undefined && executionResult.result !== null) {
            const resultStr =
              typeof executionResult.result === "string"
                ? executionResult.result
                : JSON.stringify(executionResult.result, null, 2);
            parts.push(`Result: ${resultStr}`);
          }

          if (executionResult.consoleLogs.length > 0) {
            parts.push(`Console output:\n${executionResult.consoleLogs.map(formatConsoleLog).join("\n")}`);
          }

          if (executionResult.mcpCallLogs.length > 0) {
            parts.push(`MCP calls made: ${String(executionResult.mcpCallLogs.length)}`);
          }

          if (executionResult.toolCallLogs.length > 0) {
            parts.push(`Tool calls made: ${String(executionResult.toolCallLogs.length)}`);
          }

          parts.push(`Execution time: ${String(executionResult.executionMs)}ms`);

          return parts.join("\n\n");
        },
      },
    };
  }

  private createMcpTools(server: MCPServerInfo): AgentTool[] {
    return server.cachedTools.map((mcpTool) => ({
      mcpServerId: server.id,
      tool: {
        name: mcpTool.name,
        description: mcpTool.description ?? mcpTool.name,
        parameters: { ...mcpTool.inputSchema, properties: mcpTool.inputSchema.properties ?? {} },
        execute: (args, context) => {
          const mcpManager = MCPManager.getInstance();
          return mcpManager.callTool(
            server.name,
            server.url,
            server.headers,
            mcpTool.name,
            args,
            this.config.sessionId,
            server.stateful,
            server.toolCallTimeoutSec,
            context.signal,
          );
        },
      },
    }));
  }

  private createSkillTool(agent: AgentConfig, skill: SkillBinding, mcpServerBindings: MCPServerBinding[]): AgentTool {
    return {
      skillId: skill.id,
      tool: {
        name: `skill_${skill.name}`,
        description: skill.description || skill.name,
        parameters: { ...skill.parameters, properties: skill.parameters.properties ?? {} },
        execute: async (args, context) => {
          if (!skill.code) {
            throw new Error(`Skill "${skill.name}" has no executable code`);
          }

          logger.debug({ executionId: this.executionId, skill: skill.name }, "Executing skill as tool");

          const vfs = createVFS(mcpServerBindings, []);
          vfs.writeFile("/skill.js", skill.code);

          const wrappedCode = [
            `const mod = await import('/skill.js');`,
            `const skill = mod.default;`,
            `return await skill(${JSON.stringify(args)});`,
          ].join("\n");

          const executionResult = await executeCode(wrappedCode, {
            chatSessionId: this.config.sessionId,
            vfs,
            mcpServers: mcpServerBindings,
            maxExecutionMs: agent.timeoutSec * 1000,
            maxMemoryBytes: CODE_MAX_MEMORY_BYTES,
            maxCallLogChars: agent.maxToolResponseChars,
            signal: context.signal,
          });

          for (const mcpCall of executionResult.mcpCallLogs) {
            const server = mcpServerBindings.find((s) => s.name === mcpCall.serverName);
            await this.saveToolCallFromCodeExecution(
              null,
              server?.id ?? null,
              mcpCall.toolName,
              mcpCall.args,
              mcpCall.result,
              mcpCall.error,
            );
          }

          if (executionResult.error) {
            throw new Error(executionResult.error);
          }

          const resultStr =
            typeof executionResult.result === "string"
              ? executionResult.result
              : JSON.stringify(executionResult.result, null, 2);
          return resultStr || "Action completed successfully";
        },
      },
    };
  }

  private async saveCodeExecution(
    agent: AgentConfig,
    code: string,
    reasoning: string | null,
    result: unknown,
    logs: unknown[],
    errorMessage: string | null,
    executionMs: number,
  ): Promise<string> {
    const executionId = this.executionId;
    if (!executionId) {
      throw new Error("No execution ID available");
    }

    return withUserTransaction(this.config.user, async (trx) => {
      const codeExecution = await trx
        .insertInto("aiAgentCodeExecutions")
        .values({
          executionId,
          code,
          reasoning,
          result: serialize(result, agent.maxToolResponseChars),
          logs: serialize(logs, agent.maxToolResponseChars),
          errorMessage,
          executionMs,
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      return codeExecution.id;
    });
  }

  private async saveToolCallFromCodeExecution(
    codeExecutionId: string | null,
    mcpServerId: string | null,
    toolName: string,
    args: string,
    result: string | null,
    errorMessage: string | null,
    toolProvider: string | null = null,
  ): Promise<void> {
    const executionId = this.executionId;
    if (!executionId) {
      return;
    }

    await withUserTransaction(this.config.user, async (trx) => {
      await trx
        .insertInto("aiAgentToolCalls")
        .values({
          executionId,
          codeExecutionId,
          mcpServerId,
          toolProvider,
          toolName,
          arguments: args,
          result,
          errorMessage,
          completedAt: new Date(),
        })
        .execute();
    });
  }

  private async saveToolCall(
    functionCall: LlmFunctionCall,
    agentTool: AgentTool | null,
    result: string | null,
    error: string | null,
  ): Promise<void> {
    const executionId = this.executionId;
    if (!executionId) {
      return;
    }

    await withUserTransaction(this.config.user, async (trx) => {
      await trx
        .insertInto("aiAgentToolCalls")
        .values({
          executionId,
          mcpServerId: agentTool?.mcpServerId ?? null,
          skillId: agentTool?.skillId ?? null,
          toolProvider: agentTool?.toolProvider ?? null,
          toolName: functionCall.name,
          arguments: functionCall.arguments,
          result,
          errorMessage: error,
          completedAt: new Date(),
        })
        .execute();
    });
  }

  private async loadAgent(agentId: string): Promise<AgentConfig> {
    const db = await useDb();
    const agent = await db
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
        "aiLlmProviders.id as llmProviderId",
        "aiLlmProviders.apiUrl",
        "aiLlmProviders.apiType",
        "aiLlmProviders.apiKey",
        "aiLlmProviders.headers",
      ])
      .where("aiAgents.id", "=", agentId)
      .executeTakeFirst();

    if (!agent) {
      throw new Error(`Agent ${agentId} not found or has no LLM provider assigned`);
    }

    return {
      ...agent,
      maxIterations: agent.maxIterations ?? AgentExecutorParameters.maxIterations.default,
      timeoutSec: agent.timeoutSec ?? AgentExecutorParameters.timeoutSec.default,
      maxContextChars: agent.maxContextChars ?? AgentExecutorParameters.maxContextChars.default,
      maxToolResponseChars: agent.maxToolResponseChars ?? AgentExecutorParameters.maxToolResponseChars.default,
      maxToolPartsChars: agent.maxToolPartsChars ?? AgentExecutorParameters.maxToolPartsChars.default,
    };
  }

  private async loadTriageSpecialists(triageAgentId: string): Promise<AgentConfig[]> {
    const db = await useDb();
    const specialists = await db
      .selectFrom("aiTriageSpecialists")
      .innerJoin("aiAgents", (join) => join.onRef("aiAgents.id", "=", "aiTriageSpecialists.specialistAgentId"))
      .innerJoin("aiLlmProviders", (join) => join.onRef("aiLlmProviders.id", "=", "aiAgents.llmProviderId"))
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
        "aiLlmProviders.id as llmProviderId",
        "aiLlmProviders.apiUrl",
        "aiLlmProviders.apiType",
        "aiLlmProviders.apiKey",
        "aiLlmProviders.headers",
      ])
      .where("aiTriageSpecialists.triageAgentId", "=", triageAgentId)
      .execute();

    return specialists.map((s) => ({
      ...s,
      maxIterations: s.maxIterations ?? AgentExecutorParameters.maxIterations.default,
      timeoutSec: s.timeoutSec ?? AgentExecutorParameters.timeoutSec.default,
      maxContextChars: s.maxContextChars ?? AgentExecutorParameters.maxContextChars.default,
      maxToolResponseChars: s.maxToolResponseChars ?? AgentExecutorParameters.maxToolResponseChars.default,
      maxToolPartsChars: s.maxToolPartsChars ?? AgentExecutorParameters.maxToolPartsChars.default,
    }));
  }

  private async filterUsable<R extends { id: string }>(resource: SharedResource, rows: R[]): Promise<R[]> {
    if (rows.length === 0) {
      return rows;
    }
    const ids = rows.map((row) => row.id);
    const usable = new Set(await withUserTransaction(this.config.user, (trx) => usableResourceIds(trx, resource, ids)));
    return rows.filter((row) => usable.has(row.id));
  }

  private async loadAgentMCPServers(agentId: string): Promise<MCPServerInfo[]> {
    const db = await useDb();
    const assigned = await db
      .selectFrom("aiAgentMcpServers")
      .innerJoin("aiMcpServers", "aiMcpServers.id", "aiAgentMcpServers.mcpServerId")
      .select([
        "aiMcpServers.id",
        "aiMcpServers.name",
        "aiMcpServers.url",
        "aiMcpServers.headers",
        "aiMcpServers.stateful",
        "aiMcpServers.toolCallTimeoutSec",
        "aiMcpServers.cachedTools",
      ])
      .where("aiAgentMcpServers.agentId", "=", agentId)
      .execute();
    const servers = await this.filterUsable(McpServerResource, assigned);

    return servers.map((s) => {
      const parsed = z.array(MCPToolSchema).safeParse(s.cachedTools);
      return {
        ...s,
        cachedTools: parsed.success ? parsed.data : [],
      };
    });
  }

  private async loadAgentSkills(agentId: string): Promise<SkillBinding[]> {
    const db = await useDb();
    const assigned = await db
      .selectFrom("aiAgentSkills")
      .innerJoin("aiSkills", "aiSkills.id", "aiAgentSkills.skillId")
      .select([
        "aiSkills.id",
        "aiSkills.name",
        "aiSkills.description",
        "aiSkills.documentation",
        "aiSkills.parameters",
        "aiSkills.code",
      ])
      .where("aiAgentSkills.agentId", "=", agentId)
      .execute();
    const skills = await this.filterUsable(SkillResource, assigned);

    return skills.map((s) => {
      const parsed = OpenAIFunctionParametersSchema.safeParse(s.parameters);
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        documentation: s.documentation,
        parameters: parsed.success ? parsed.data : { type: "object", properties: {}, required: [] },
        code: s.code,
      };
    });
  }

  private async buildContext(agent: AgentConfig, options: { toolCalls: boolean }): Promise<LlmItem[]> {
    const db = await useDb();
    const query = db
      .selectFrom("aiChatMessages")
      .select(["id", "role", "content", "items"])
      .where("sessionId", "=", this.config.sessionId)
      .where("role", "in", ["user", "assistant", "system"]);

    const result: LlmItem[][] = [];

    let totalChars = 0;
    let cursor: PageCursor | undefined;
    do {
      const page = await paginate(query, {
        table: "aiChatMessages",
        orderBy: "createdAt",
        order: "desc",
        limit: CONTEXT_PAGE_SIZE,
        cursor,
      });

      for (const m of page.rows) {
        const parsed = z.array(LlmItemSchema).safeParse(m.items);
        const message: LlmItem = {
          type: "message",
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        };
        let items = options.toolCalls && parsed.success && parsed.data.length > 0 ? parsed.data : [message];
        // An answer whose tool calls do not fit is kept as what it said
        if (result.length > 0 && totalChars + countChars(items) > agent.maxContextChars) {
          items = [message];
        }
        // Always keep the newest message, even if it alone exceeds the budget
        if (result.length > 0 && totalChars + countChars(items) > agent.maxContextChars) {
          return result.reverse().flat();
        }
        result.push(items);
        totalChars += countChars(items);
      }

      cursor = page.nextCursor;
    } while (cursor && result.length < CONTEXT_MAX_MESSAGES);

    return result.reverse().flat();
  }

  private async saveAssistantMessage(answer: LlmItem[]): Promise<void> {
    const content = answer
      .filter((item) => item.type === "message")
      .map((item) => item.content)
      .join("");

    // The reasoning only lasts for the execution, and a tool call left without its output cannot be sent again
    const callIds = new Set(answer.filter((item) => item.type === "function_call_output").map((item) => item.call_id));
    const items = answer.filter(
      (item) => item.type !== "reasoning" && (item.type !== "function_call" || callIds.has(item.call_id)),
    );

    // An answer without text is only kept for what its tool calls show the user
    if (
      !content &&
      !items.some((item) => item.type === "function_call" && (item.parts !== undefined || item.description))
    ) {
      return;
    }

    await withUserTransaction(
      this.config.user,
      async (trx) => {
        const assistantMessage = await trx
          .insertInto("aiChatMessages")
          .values({
            sessionId: this.config.sessionId,
            role: "assistant",
            content,
            items: JSON.stringify(items),
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        if (this.executionId) {
          await trx
            .updateTable("aiAgentExecutions")
            .set({ outputMessageId: assistantMessage.id })
            .where("id", "=", this.executionId)
            .execute();
        }

        await trx
          .updateTable("aiChatSessions")
          .set({ updatedAt: new Date() })
          .where("id", "=", this.config.sessionId)
          .execute();
      },
      { trustedWrites: true },
    );
  }

  private async updateLastActivity(): Promise<void> {
    if (!this.executionId) {
      return;
    }

    await withUserTransaction(
      this.config.user,
      async (trx) => {
        await trx
          .updateTable("aiAgentExecutions")
          .set({ lastActivityAt: new Date() })
          .where("id", "=", this.executionId)
          .execute();
      },
      { trustedWrites: true },
    );
  }

  private async completeExecution({ status, errorMessage }: ExecutionOutcome): Promise<void> {
    if (!this.executionId) {
      return;
    }

    await withUserTransaction(
      this.config.user,
      async (trx) => {
        await trx
          .updateTable("aiAgentExecutions")
          .set({
            status,
            errorMessage: errorMessage ?? null,
            completedAt: new Date(),
            lastActivityAt: new Date(),
          })
          .where("id", "=", this.executionId)
          .execute();
      },
      { trustedWrites: true },
    );
  }

  public static async failAbandonedExecutions(db: Kysely<Database>, sessionId?: string): Promise<number> {
    const now = new Date();
    let query = db
      .updateTable("aiAgentExecutions")
      .set({
        status: "failed",
        errorMessage: `Execution abandoned (no activity for over ${String(EXECUTION_STALE_MS / 1000)} seconds)`,
        completedAt: now,
        lastActivityAt: now,
      })
      .where("status", "=", "running")
      .where("lastActivityAt", "<", new Date(now.getTime() - EXECUTION_STALE_MS));

    if (sessionId !== undefined) {
      query = query.where("sessionId", "=", sessionId);
    }

    const abandoned = await query.returning(["id"]).execute();
    return abandoned.length;
  }

  private createLlmClient(agent: AgentConfig): LlmClient {
    return new LlmClient({
      apiUrl: agent.apiUrl,
      apiType: agent.apiType,
      apiKey: agent.apiKey,
      headers: agent.headers,
      model: agent.model,
      summaryModel: agent.summaryModel ?? undefined,
      streaming: agent.streaming,
    });
  }

  private checkTimeout(agent: AgentConfig): boolean {
    const elapsed = (Date.now() - this.startedAt.getTime()) / 1000;
    return elapsed < agent.timeoutSec;
  }

  private withTimeout(agent: AgentConfig, signal?: AbortSignal): AbortSignal {
    const remainingMs = Math.max(agent.timeoutSec * 1000 - (Date.now() - this.startedAt.getTime()), 0);
    const timeout = AbortSignal.timeout(remainingMs);
    return signal ? AbortSignal.any([timeout, signal]) : timeout;
  }
}
