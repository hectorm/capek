import superjson from "superjson";
import { z } from "zod/v4";

import type { AuthUser } from "~~/server/lib/authn/strategies";
import type { MCPServerBinding, SkillBinding } from "~~/server/lib/code/generators";
import type { MCPServerInfo } from "~~/server/lib/mcp/tools";
import type { HttpHeader } from "~~/shared/http";
import type { OpenAIMessage, OpenAITool, OpenAIToolCall } from "~~/shared/openai";
import { buildCodeInterpreterPrompt, buildSkillToolsPrompt, buildTriagePrompt } from "~~/server/lib/agents/prompts";
import { createVFS } from "~~/server/lib/code/generators";
import { executeCode } from "~~/server/lib/code/interpreter";
import { loadSessionWorkspace, saveSessionWorkspace } from "~~/server/lib/code/persistence";
import { useDb, withUserTransaction } from "~~/server/lib/database";
import { AbortError, MaxIterationsError, TimeoutError } from "~~/server/lib/errors";
import { useLogger } from "~~/server/lib/logger";
import { MCPManager } from "~~/server/lib/mcp/manager";
import { ensureToolsDiscovered, findServerForTool } from "~~/server/lib/mcp/tools";
import { OpenAIManager } from "~~/server/lib/openai/manager";
import { OpenAIStreamProcessor } from "~~/server/lib/openai/stream";
import { SSEProcessor } from "~~/server/lib/sse";
import { AgentExecutorParameters } from "~~/shared/agent";
import { ChatStreamEvents } from "~~/shared/chat";
import { MCPToolSchema } from "~~/shared/mcp";
import { OpenAICompletionResponseSchema, OpenAIFunctionParametersSchema } from "~~/shared/openai";

const logger = useLogger();

const streamEncoder = new TextEncoder();

const encodeStreamEvent = (event: string, data: string): Uint8Array => {
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
  codeInterpreter: boolean;
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
  llmProviderId: string;
  apiUrl: string;
  apiKey: string;
  headers: HttpHeader[];
}

const executeCodeToolSchema = z.object({
  code: z.string(),
  reasoning: z.string().optional(),
});

const triageToolSchema = z.object({
  specialistId: z.string(),
  routingReason: z.string(),
});

export class AgentExecutor {
  private config: AgentExecutorConfig;
  private executionId: string | null = null;
  private openAIClientIds: string[] = [];
  private iterationCount = 0;
  private startedAt: Date;

  public constructor(config: AgentExecutorConfig) {
    this.config = config;
    this.startedAt = new Date();
  }

  public async createExecution(agentId: string): Promise<string> {
    return withUserTransaction(this.config.user, async (trx) => {
      const userMessage = await trx
        .insertInto("chatMessages")
        .values({
          sessionId: this.config.sessionId,
          role: "user",
          content: this.config.message,
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      const execution = await trx
        .insertInto("agentExecutions")
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
  }

  public async *executeStream(agentId: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    try {
      if (!this.executionId) {
        await this.createExecution(agentId);
      }

      const agent = await this.loadAgent(agentId);

      await this.updateLastActivity();

      if (agent.type === "triage") {
        yield* this.executeTriageStream(agent, signal);
      } else {
        yield* this.executeSpecialistStream(agent, signal);
      }

      await this.completeExecution("completed");
    } catch (error) {
      if (error instanceof AbortError || error instanceof TimeoutError || error instanceof MaxIterationsError) {
        await this.completeExecution("cancelled", error.message);
      } else {
        await this.completeExecution("failed", error instanceof Error ? error.message : String(error));
      }
      throw error;
    } finally {
      this.cleanup();
    }
  }

  private async *executeTriageStream(agent: AgentConfig, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    const specialists = await this.loadTriageSpecialists(agent.id);

    if (specialists.length === 0) {
      throw new Error("No specialists assigned to this triage agent");
    }

    const triageInstructions = buildTriagePrompt(agent.instructions, specialists);

    const tools = [
      {
        type: "function" as const,
        function: {
          name: "route_to_specialist",
          description: "Route the user's request to the most appropriate specialist agent",
          parameters: {
            type: "object" as const,
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
      },
    ];

    const messages = await this.buildMessageContext(agent);
    const contextMessages: OpenAIMessage[] = [this.createMessage("system", triageInstructions), ...messages];

    const openAIClient = this.getOpenAIClient(agent);
    const completion = await openAIClient.completion(
      {
        messages: contextMessages,
        model: agent.model,
        temperature: agent.temperature ?? undefined,
        max_completion_tokens: agent.maxTokens ?? undefined,
        top_p: agent.topP ?? undefined,
        frequency_penalty: agent.frequencyPenalty ?? undefined,
        presence_penalty: agent.presencePenalty ?? undefined,
        tools,
        tool_choice: "required",
        stream: false,
      },
      signal,
    );

    if (completion instanceof ReadableStream) {
      throw new Error("Streaming not supported for triage agent");
    }

    const parsed = OpenAICompletionResponseSchema.safeParse(completion);
    if (!parsed.success || !parsed.data.choices[0]) {
      throw new Error("Invalid completion response from triage agent");
    }

    const choice = parsed.data.choices[0];
    const toolCalls = choice.message.tool_calls;
    if (!toolCalls?.[0]) {
      throw new Error("Triage agent failed to select a specialist");
    }

    const toolCall = toolCalls[0];

    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(toolCall.function.arguments);
    } catch {
      throw new Error("Triage agent returned invalid JSON for tool arguments");
    }
    const args = triageToolSchema.parse(rawArgs);

    const specialist = specialists.find((s) => s.id === args.specialistId);
    if (!specialist) {
      throw new Error(`Selected specialist "${args.specialistId}" not found`);
    }

    yield encodeStreamEvent(ChatStreamEvents.Status, args.routingReason);

    await this.updateLastActivity();

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

    let systemInstructions = agent.instructions;
    let tools: OpenAITool[];

    if (agent.codeInterpreter && agent.type === "specialist") {
      systemInstructions = [agent.instructions, "", buildCodeInterpreterPrompt()].join("\n");

      tools = [
        {
          type: "function" as const,
          function: {
            name: "execute_code",
            description: [
              "Execute JavaScript code in a sandboxed environment with access to MCP server APIs.",
              "Use this to perform complex operations, process data, or call multiple APIs.",
            ].join("\n"),
            parameters: {
              type: "object" as const,
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
          },
        },
      ];
    } else {
      const mcpTools = mcpServers.flatMap((s) =>
        s.cachedTools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description ?? t.name,
            parameters: t.inputSchema,
          },
        })),
      );

      const executableSkills = skillBindings.filter((s) => s.code !== null);
      const skillTools: OpenAITool[] = executableSkills.map((skill) => ({
        type: "function" as const,
        function: {
          name: `skill_${skill.name}`,
          description: skill.description || skill.name,
          parameters: skill.parameters,
        },
      }));

      tools = [...mcpTools, ...skillTools];

      if (executableSkills.length > 0) {
        systemInstructions = [agent.instructions, "", buildSkillToolsPrompt()].join("\n");
      }
    }

    const messages = await this.buildMessageContext(agent);
    const messageHistory: OpenAIMessage[] = [this.createMessage("system", systemInstructions), ...messages];

    let accumulatedContent = "";
    let completed = false;

    try {
      while (this.iterationCount < agent.maxIterations) {
        if (!this.checkTimeout(agent)) {
          throw new TimeoutError();
        }

        this.iterationCount++;

        await this.updateLastActivity();

        const openAIClient = this.getOpenAIClient(agent);
        const completion = await openAIClient.completion(
          {
            messages: messageHistory,
            model: agent.model,
            temperature: agent.temperature ?? undefined,
            max_completion_tokens: agent.maxTokens ?? undefined,
            top_p: agent.topP ?? undefined,
            frequency_penalty: agent.frequencyPenalty ?? undefined,
            presence_penalty: agent.presencePenalty ?? undefined,
            tools: tools.length > 0 ? tools : undefined,
          },
          signal,
        );

        if (!(completion instanceof ReadableStream)) {
          const parsed = OpenAICompletionResponseSchema.safeParse(completion);
          if (!parsed.success || !parsed.data.choices[0]) {
            throw new Error("Invalid completion response from specialist agent");
          }

          const firstChoice = parsed.data.choices[0];
          const content = firstChoice.message.content ?? "";
          accumulatedContent += content;

          if (content) {
            yield encodeStreamEvent(ChatStreamEvents.Token, content);
          }

          const toolCalls = firstChoice.message.tool_calls;
          if (!toolCalls || toolCalls.length === 0) {
            completed = true;
            break;
          }

          const assistantMessage = this.createMessage("assistant", firstChoice.message.content ?? "", {
            toolCalls: firstChoice.message.tool_calls ?? undefined,
          });
          messageHistory.push(assistantMessage);
          yield* this.handleToolCalls(
            toolCalls,
            mcpServers,
            mcpServerBindings,
            skillBindings,
            messageHistory,
            agent,
            signal,
          );
          continue;
        }

        const reader = completion.getReader();
        const streamProcessor = new OpenAIStreamProcessor();
        const pendingTokens: string[] = [];

        try {
          const sseProcessor = new SSEProcessor({
            onEvent: (event) => {
              const chunk = streamProcessor.parseChunk(event.data);
              if (chunk) {
                streamProcessor.processChunk(chunk);
                const delta = chunk.choices.at(0)?.delta.content;
                if (delta) {
                  pendingTokens.push(delta);
                }
              }
            },
          });

          while (!signal?.aborted) {
            const { done, value } = await reader.read();
            if (done) break;

            sseProcessor.process(value);
            while (pendingTokens.length > 0) {
              yield encodeStreamEvent(ChatStreamEvents.Token, pendingTokens.shift() ?? "");
            }
          }

          sseProcessor.flush();
          while (pendingTokens.length > 0) {
            yield encodeStreamEvent(ChatStreamEvents.Token, pendingTokens.shift() ?? "");
          }
        } finally {
          reader.releaseLock();
        }

        const contentDelta = streamProcessor.getContent();
        accumulatedContent += contentDelta;

        if (streamProcessor.hasToolCalls()) {
          const currentToolCalls = streamProcessor.getToolCalls();
          const assistantMessage = this.createMessage("assistant", contentDelta, { toolCalls: currentToolCalls });
          messageHistory.push(assistantMessage);

          yield* this.handleToolCalls(
            currentToolCalls,
            mcpServers,
            mcpServerBindings,
            skillBindings,
            messageHistory,
            agent,
            signal,
          );
          streamProcessor.reset();
        } else {
          completed = true;
          break;
        }
      }
    } finally {
      if (accumulatedContent) {
        try {
          await this.saveAssistantMessage(accumulatedContent);
        } catch (error) {
          logger.error({ executionId: this.executionId, error }, "Failed to persist streamed answer");
        }
      }
    }

    if (!completed) {
      throw new MaxIterationsError();
    }
  }

  private async *handleToolCalls(
    toolCalls: OpenAIToolCall[],
    mcpServers: MCPServerInfo[],
    mcpServerBindings: MCPServerBinding[],
    skillBindings: SkillBinding[],
    messageHistory: OpenAIMessage[],
    agent: AgentConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<Uint8Array> {
    await this.updateLastActivity();

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;

      if (toolName === "execute_code" && agent.codeInterpreter) {
        yield* this.handleCodeExecution(toolCall, mcpServerBindings, skillBindings, messageHistory, agent, signal);
        continue;
      }

      if (toolName.startsWith("skill_")) {
        const skillName = toolName.slice(6);
        const skill = skillBindings.find((s) => s.name === skillName);
        if (skill) {
          yield* this.handleSkillToolCall(toolCall, skill, mcpServerBindings, messageHistory, agent, signal);
          continue;
        }
      }

      yield* this.handleMcpToolCall(toolCall, mcpServers, messageHistory, agent, signal);
    }

    yield encodeStreamEvent(ChatStreamEvents.Status, "");

    await this.updateLastActivity();
  }

  private async *handleCodeExecution(
    toolCall: OpenAIToolCall,
    mcpServerBindings: MCPServerBinding[],
    skillBindings: SkillBinding[],
    messageHistory: OpenAIMessage[],
    agent: AgentConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<Uint8Array> {
    let parsedArgs: { code: string; reasoning?: string };
    try {
      const raw: unknown = JSON.parse(toolCall.function.arguments);
      parsedArgs = executeCodeToolSchema.parse(raw);
    } catch (parseError) {
      const errorMessage = `Failed to parse execute_code arguments: ${toolCall.function.arguments}`;
      logger.error({ executionId: this.executionId, parseError }, errorMessage);
      messageHistory.push(this.createMessage("tool", `Error: ${errorMessage}`, { toolCallId: toolCall.id }));
      return;
    }

    yield encodeStreamEvent(ChatStreamEvents.Status, "execute_code");

    logger.debug(
      { executionId: this.executionId, codeLength: parsedArgs.code.length },
      "Executing code in interpreter",
    );

    const vfs = createVFS(mcpServerBindings, skillBindings);

    await loadSessionWorkspace(vfs, this.config.sessionId, this.config.user);

    const executionResult = await executeCode(parsedArgs.code, {
      chatSessionId: this.config.sessionId,
      vfs,
      mcpServers: mcpServerBindings,
      maxExecutionMs: agent.timeoutSec * 1000,
      maxMemoryBytes: 25 * 1024 * 1024,
      signal,
    });

    await saveSessionWorkspace(vfs, this.config.sessionId, this.config.user);

    const codeExecutionId = await this.saveCodeExecution(
      parsedArgs.code,
      parsedArgs.reasoning ?? null,
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
        JSON.stringify(mcpCall.args),
        mcpCall.result,
        mcpCall.error,
      );
    }

    let resultMessage: string;
    if (executionResult.error) {
      resultMessage = `Error: ${executionResult.error}`;
    } else {
      const parts: string[] = [];

      if (executionResult.result !== undefined && executionResult.result !== null) {
        const resultStr =
          typeof executionResult.result === "string"
            ? executionResult.result
            : JSON.stringify(executionResult.result, null, 2);
        parts.push(`Result: ${resultStr}`);
      }

      if (executionResult.consoleLogs.length > 0) {
        const logLines = executionResult.consoleLogs.map((log) => {
          const argsStr = log.args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
          return `[${log.level}] ${argsStr}`;
        });
        parts.push(`Console output:\n${logLines.join("\n")}`);
      }

      if (executionResult.mcpCallLogs.length > 0) {
        parts.push(`MCP calls made: ${String(executionResult.mcpCallLogs.length)}`);
      }

      parts.push(`Execution time: ${String(executionResult.executionMs)}ms`);

      resultMessage = parts.join("\n\n");
    }

    if (resultMessage.length > agent.maxToolResponseChars) {
      const originalLength = resultMessage.length;
      const truncatedLength = agent.maxToolResponseChars;
      logger.debug({ originalLength, truncatedLength }, "Code execution result truncated");
      resultMessage = resultMessage.slice(0, agent.maxToolResponseChars);
      resultMessage += `\n\n[Response truncated: ${String(originalLength)} characters, showing first ${String(truncatedLength)}]`;
    }

    messageHistory.push(this.createMessage("tool", resultMessage, { toolCallId: toolCall.id }));
  }

  private async *handleMcpToolCall(
    toolCall: OpenAIToolCall,
    mcpServers: MCPServerInfo[],
    messageHistory: OpenAIMessage[],
    agent: AgentConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<Uint8Array> {
    const toolName = toolCall.function.name;
    const mcpServer = findServerForTool(toolName, mcpServers);

    if (!mcpServer) {
      const errorMessage = `Tool "${toolName}" not found in any assigned MCP server`;
      logger.error({ toolName, executionId: this.executionId }, errorMessage);
      await this.saveToolCall(toolCall, null, null, null, null, errorMessage);
      messageHistory.push(this.createMessage("tool", `Error: ${errorMessage}`, { toolCallId: toolCall.id }));
      return;
    }

    let args: Record<string, unknown>;
    try {
      const raw: unknown = JSON.parse(toolCall.function.arguments);
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("Tool arguments must be a JSON object");
      }
      args = raw as Record<string, unknown>;
    } catch (parseError) {
      const errorMessage = `Failed to parse MCP tool arguments: ${toolCall.function.arguments}`;
      logger.error({ toolName, executionId: this.executionId, parseError }, errorMessage);
      await this.saveToolCall(toolCall, null, null, null, null, errorMessage);
      messageHistory.push(this.createMessage("tool", `Error: ${errorMessage}`, { toolCallId: toolCall.id }));
      return;
    }

    yield encodeStreamEvent(ChatStreamEvents.Status, toolName);

    try {
      const mcpManager = MCPManager.getInstance();
      let result = await mcpManager.callTool(
        mcpServer.name,
        mcpServer.url,
        mcpServer.headers,
        toolName,
        args,
        this.config.sessionId,
        mcpServer.stateful,
        mcpServer.toolCallTimeoutSec,
        signal,
      );

      await this.saveToolCall(toolCall, mcpServer.id, null, null, result, null);

      if (result.length > agent.maxToolResponseChars) {
        const originalLength = result.length;
        const truncatedLength = agent.maxToolResponseChars;
        logger.debug({ toolName, originalLength, truncatedLength }, "MCP tool response truncated");
        result = result.slice(0, agent.maxToolResponseChars);
        result += `\n\n[Response truncated: ${String(originalLength)} characters, showing first ${String(truncatedLength)}]`;
      }

      messageHistory.push(this.createMessage("tool", result, { toolCallId: toolCall.id }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ toolName, mcpServer: mcpServer.name, error: errorMessage }, "MCP tool execution failed");

      await this.saveToolCall(toolCall, mcpServer.id, null, null, null, errorMessage);

      messageHistory.push(this.createMessage("tool", `Error: ${errorMessage}`, { toolCallId: toolCall.id }));
    }
  }

  private async *handleSkillToolCall(
    toolCall: OpenAIToolCall,
    skill: SkillBinding,
    mcpServerBindings: MCPServerBinding[],
    messageHistory: OpenAIMessage[],
    agent: AgentConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<Uint8Array> {
    let args: Record<string, unknown>;
    try {
      const raw: unknown = JSON.parse(toolCall.function.arguments);
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("Skill arguments must be a JSON object");
      }
      args = raw as Record<string, unknown>;
    } catch (parseError) {
      const errorMessage = `Failed to parse skill arguments: ${toolCall.function.arguments}`;
      logger.error({ executionId: this.executionId, skill: skill.name, parseError }, errorMessage);
      await this.saveToolCall(toolCall, null, skill.id, null, null, errorMessage);
      messageHistory.push(this.createMessage("tool", `Error: ${errorMessage}`, { toolCallId: toolCall.id }));
      return;
    }

    yield encodeStreamEvent(ChatStreamEvents.Status, `skill_${skill.name}`);

    if (!skill.code) {
      const errorMessage = `Skill "${skill.name}" has no executable code`;
      logger.error({ executionId: this.executionId, skill: skill.name }, errorMessage);
      messageHistory.push(this.createMessage("tool", `Error: ${errorMessage}`, { toolCallId: toolCall.id }));
      return;
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
      maxMemoryBytes: 25 * 1024 * 1024,
      signal,
    });

    for (const mcpCall of executionResult.mcpCallLogs) {
      const server = mcpServerBindings.find((s) => s.name === mcpCall.serverName);
      await this.saveToolCallFromCodeExecution(
        null,
        server?.id ?? null,
        mcpCall.toolName,
        JSON.stringify(mcpCall.args),
        mcpCall.result,
        mcpCall.error,
      );
    }

    let resultMessage: string;
    if (executionResult.error) {
      resultMessage = `Error: ${executionResult.error}`;
      logger.error({ skill: skill.name, error: executionResult.error }, "Skill execution failed");
    } else {
      const resultStr =
        typeof executionResult.result === "string"
          ? executionResult.result
          : JSON.stringify(executionResult.result, null, 2);
      resultMessage = resultStr || "Action completed successfully";
    }

    if (resultMessage.length > agent.maxToolResponseChars) {
      const originalLength = resultMessage.length;
      const truncatedLength = agent.maxToolResponseChars;
      logger.debug({ originalLength, truncatedLength }, "Skill result truncated");
      resultMessage = resultMessage.slice(0, agent.maxToolResponseChars);
      resultMessage += `\n\n[Response truncated: ${String(originalLength)} characters, showing first ${String(truncatedLength)}]`;
    }

    messageHistory.push(this.createMessage("tool", resultMessage, { toolCallId: toolCall.id }));

    await this.saveToolCall(
      toolCall,
      null,
      skill.id,
      null,
      executionResult.error ? null : resultMessage,
      executionResult.error ?? null,
    );
  }

  private async saveCodeExecution(
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
        .insertInto("agentCodeExecutions")
        .values({
          executionId,
          code,
          reasoning,
          result: superjson.stringify(result),
          logs: superjson.stringify(logs),
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
  ): Promise<void> {
    const executionId = this.executionId;
    if (!executionId) return;

    await withUserTransaction(this.config.user, async (trx) => {
      await trx
        .insertInto("agentToolCalls")
        .values({
          executionId,
          codeExecutionId,
          mcpServerId,
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
    toolCall: OpenAIToolCall,
    mcpServerId: string | null,
    skillId: string | null,
    codeExecutionId: string | null,
    result: string | null,
    error: string | null,
  ): Promise<void> {
    const executionId = this.executionId;
    if (!executionId) return;

    await withUserTransaction(this.config.user, async (trx) => {
      await trx
        .insertInto("agentToolCalls")
        .values({
          executionId,
          mcpServerId,
          skillId,
          codeExecutionId,
          toolName: toolCall.function.name,
          arguments: toolCall.function.arguments,
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
      .selectFrom("agents")
      .innerJoin("llmProviders", "llmProviders.id", "agents.llmProviderId")
      .select([
        "agents.id",
        "agents.name",
        "agents.description",
        "agents.instructions",
        "agents.type",
        "agents.model",
        "agents.summaryModel",
        "agents.codeInterpreter",
        "agents.streaming",
        "agents.temperature",
        "agents.maxTokens",
        "agents.topP",
        "agents.frequencyPenalty",
        "agents.presencePenalty",
        "agents.maxIterations",
        "agents.timeoutSec",
        "agents.maxContextChars",
        "agents.maxToolResponseChars",
        "llmProviders.id as llmProviderId",
        "llmProviders.apiUrl",
        "llmProviders.apiKey",
        "llmProviders.headers",
      ])
      .where("agents.id", "=", agentId)
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
    };
  }

  private async loadTriageSpecialists(triageAgentId: string): Promise<AgentConfig[]> {
    const db = await useDb();
    const specialists = await db
      .selectFrom("triageSpecialists")
      .innerJoin("agents", (join) => join.onRef("agents.id", "=", "triageSpecialists.specialistAgentId"))
      .innerJoin("llmProviders", (join) => join.onRef("llmProviders.id", "=", "agents.llmProviderId"))
      .select([
        "agents.id",
        "agents.name",
        "agents.description",
        "agents.instructions",
        "agents.type",
        "agents.model",
        "agents.summaryModel",
        "agents.codeInterpreter",
        "agents.streaming",
        "agents.temperature",
        "agents.maxTokens",
        "agents.topP",
        "agents.frequencyPenalty",
        "agents.presencePenalty",
        "agents.maxIterations",
        "agents.timeoutSec",
        "agents.maxContextChars",
        "agents.maxToolResponseChars",
        "llmProviders.id as llmProviderId",
        "llmProviders.apiUrl",
        "llmProviders.apiKey",
        "llmProviders.headers",
      ])
      .where("triageSpecialists.triageAgentId", "=", triageAgentId)
      .execute();

    return specialists.map((s) => ({
      ...s,
      maxIterations: s.maxIterations ?? AgentExecutorParameters.maxIterations.default,
      timeoutSec: s.timeoutSec ?? AgentExecutorParameters.timeoutSec.default,
      maxContextChars: s.maxContextChars ?? AgentExecutorParameters.maxContextChars.default,
      maxToolResponseChars: s.maxToolResponseChars ?? AgentExecutorParameters.maxToolResponseChars.default,
    }));
  }

  private async loadAgentMCPServers(agentId: string): Promise<MCPServerInfo[]> {
    const db = await useDb();
    const servers = await db
      .selectFrom("agentMcpServers")
      .innerJoin("mcpServers", "mcpServers.id", "agentMcpServers.mcpServerId")
      .select([
        "mcpServers.id",
        "mcpServers.name",
        "mcpServers.url",
        "mcpServers.headers",
        "mcpServers.stateful",
        "mcpServers.toolCallTimeoutSec",
        "mcpServers.cachedTools",
      ])
      .where("agentMcpServers.agentId", "=", agentId)
      .execute();

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
    const skills = await db
      .selectFrom("agentSkills")
      .innerJoin("skills", "skills.id", "agentSkills.skillId")
      .select([
        "skills.id",
        "skills.name",
        "skills.description",
        "skills.documentation",
        "skills.parameters",
        "skills.code",
      ])
      .where("agentSkills.agentId", "=", agentId)
      .execute();

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

  private async buildMessageContext(agent: AgentConfig): Promise<OpenAIMessage[]> {
    const db = await useDb();
    const messages = await db
      .selectFrom("chatMessages")
      .select(["role", "content"])
      .where("sessionId", "=", this.config.sessionId)
      .where("role", "in", ["user", "assistant", "system"])
      .orderBy("createdAt", "desc")
      .execute();

    const result: OpenAIMessage[] = [];

    let totalChars = 0;
    for (const m of messages) {
      const msg = m as { role: string; content: string };
      if (totalChars + msg.content.length > agent.maxContextChars) break;
      result.push(this.createMessage(msg.role as "user" | "assistant" | "system", msg.content));
      totalChars += msg.content.length;
    }

    return result.reverse();
  }

  private async saveAssistantMessage(content: string): Promise<void> {
    await withUserTransaction(this.config.user, async (trx) => {
      const assistantMessage = await trx
        .insertInto("chatMessages")
        .values({
          sessionId: this.config.sessionId,
          role: "assistant",
          content,
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      if (this.executionId) {
        await trx
          .updateTable("agentExecutions")
          .set({ outputMessageId: assistantMessage.id })
          .where("id", "=", this.executionId)
          .execute();
      }

      await trx
        .updateTable("chatSessions")
        .set({ updatedAt: new Date() })
        .where("id", "=", this.config.sessionId)
        .execute();
    });
  }

  private async updateLastActivity(): Promise<void> {
    if (!this.executionId) return;

    await withUserTransaction(this.config.user, async (trx) => {
      await trx
        .updateTable("agentExecutions")
        .set({ lastActivityAt: new Date() })
        .where("id", "=", this.executionId)
        .execute();
    });
  }

  private async completeExecution(status: "completed" | "failed" | "cancelled", errorMessage?: string): Promise<void> {
    if (!this.executionId) return;

    await withUserTransaction(this.config.user, async (trx) => {
      await trx
        .updateTable("agentExecutions")
        .set({
          status,
          errorMessage: errorMessage ?? null,
          completedAt: new Date(),
          lastActivityAt: new Date(),
        })
        .where("id", "=", this.executionId)
        .execute();
    });
  }

  private createMessage(
    role: "user" | "assistant" | "system" | "tool",
    content: string,
    options?: { toolCallId?: string; toolCalls?: OpenAIToolCall[] },
  ): OpenAIMessage {
    const message: OpenAIMessage = { role, content };

    if (options?.toolCallId) {
      message.tool_call_id = options.toolCallId;
    }
    if (options?.toolCalls && options.toolCalls.length > 0) {
      message.tool_calls = options.toolCalls;
    }

    return message;
  }

  private getOpenAIClient(agent: AgentConfig) {
    const openAIManager = OpenAIManager.getInstance();
    const executionId = this.executionId ?? "unknown";
    const clientId = `exec-${executionId}-agent-${agent.id}`;

    if (openAIManager.hasClient(clientId)) {
      return openAIManager.getClient(clientId);
    }

    this.openAIClientIds.push(clientId);
    return openAIManager.addClient(clientId, {
      apiUrl: agent.apiUrl,
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

  public cleanup(): void {
    if (this.openAIClientIds.length > 0) {
      const openAIManager = OpenAIManager.getInstance();
      for (const clientId of this.openAIClientIds) {
        openAIManager.removeClient(clientId);
      }
      this.openAIClientIds = [];
    }
  }
}
