import http from "node:http";
import { setTimeout } from "node:timers";

export interface MockLLMServerOptions {
  port: number;
}

interface OpenAICompletionRequest {
  model: string;
  messages?: { role: string; content: string | null; tool_calls?: unknown[] }[];
  stream?: boolean;
  tools?: { type: string; function: { name: string } }[];
  tool_choice?: string | { type: string; function: { name: string } };
}

export class MockLLMServer {
  private server: http.Server | null = null;
  private port: number;
  private readonly response = "This is a mock response";

  public constructor(options: MockLLMServerOptions) {
    this.port = options.port;
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on("error", reject);
      this.server.listen(this.port, () => {
        console.info(`Mock LLM server listening on port ${String(this.port)}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.info("Mock LLM server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      if (req.url === "/v1/models") {
        this.handleModels(req, res);
      } else if (req.url === "/v1/chat/completions") {
        this.handleChatCompletions(req, body, res);
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      }
    });
  }

  private handleModels(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const response = {
      object: "list",
      data: [
        {
          id: "goody-2",
          object: "model",
          created: 1700000000,
          owned_by: "mock",
        },
      ],
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  private handleChatCompletions(req: http.IncomingMessage, body: string, res: http.ServerResponse): void {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    let request: OpenAICompletionRequest;
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed !== "object" || parsed === null || !("model" in parsed) || typeof parsed.model !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing required field: model" }));
        return;
      }
      request = parsed as OpenAICompletionRequest;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    // Check if this is a triage agent request (tool_choice: "required" with route_to_specialist tool)
    if (request.tool_choice === "required" && request.tools?.some((t) => t.function.name === "route_to_specialist")) {
      this.handleTriageCompletion(request, res);
      return;
    }

    const isAfterToolResponse = request.messages?.at(-1)?.role === "tool";
    const hasTool = (name: string): boolean => request.tools?.some((t) => t.function.name === name) ?? false;

    // Code interpreter: call execute_code or handle its response
    if (hasTool("execute_code")) {
      if (!isAfterToolResponse) {
        if (request.stream) this.handleStreamingCodeExecutionToolCall(request, res);
        else this.handleNonStreamingCodeExecutionToolCall(request, res);
      } else {
        if (request.stream) this.handleStreamingCodeExecutionResponse(request, res);
        else this.handleNonStreamingCodeExecutionResponse(request, res);
      }
      return;
    }

    // Skill tool: call skill_rot13 or handle its response (only if message mentions rot13)
    if (hasTool("skill_rot13") && this.getLastUserMessageContent(request).includes("rot13")) {
      if (!isAfterToolResponse) {
        if (request.stream) this.handleStreamingSkillToolCall(request, res);
        else this.handleNonStreamingSkillToolCall(request, res);
      } else {
        if (request.stream) this.handleStreamingSkillToolResponse(request, res);
        else this.handleNonStreamingSkillToolResponse(request, res);
      }
      return;
    }

    // MCP tools or default completion
    if (request.tools?.length && !isAfterToolResponse) {
      if (request.stream) this.handleStreamingToolCallCompletion(request, res);
      else this.handleNonStreamingToolCallCompletion(request, res);
    } else {
      if (request.stream) this.handleStreamingCompletion(request, res);
      else this.handleNonStreamingCompletion(request, res);
    }
  }

  private getLastUserMessageContent(request: OpenAICompletionRequest): string {
    const userMessages = request.messages?.filter((m) => m.role === "user") ?? [];
    const lastUserMessage = userMessages.at(-1)?.content ?? "";
    return typeof lastUserMessage === "string" ? lastUserMessage : "";
  }

  private handleTriageCompletion(request: OpenAICompletionRequest, res: http.ServerResponse): void {
    const routeTool = request.tools?.find((t) => t.function.name === "route_to_specialist");
    const toolDef = routeTool?.function as
      { parameters?: { properties?: { specialistId?: { enum?: string[] } } } } | undefined;
    const specialistIds = toolDef?.parameters?.properties?.specialistId?.enum ?? [];

    // Always route to the first specialist
    const specialistId = specialistIds[0] ?? "unknown";

    const response = {
      id: "chatcmpl-mock-triage",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_triage_001",
                type: "function",
                function: {
                  name: "route_to_specialist",
                  arguments: JSON.stringify({ specialistId, routingReason: "Routing to the specialist for testing" }),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  private handleNonStreamingToolCallCompletion(request: OpenAICompletionRequest, res: http.ServerResponse): void {
    const response = {
      id: "chatcmpl-mock-tool",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_tool_001",
                type: "function",
                function: {
                  name: request.tools?.[0]?.function.name ?? "unknown_tool",
                  arguments: JSON.stringify({ query: "mock test query" }),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  private handleStreamingToolCallCompletion(request: OpenAICompletionRequest, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const toolCallChunk = {
      id: "chatcmpl-mock-tool-stream",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                index: 0,
                id: "call_tool_001",
                type: "function",
                function: {
                  name: request.tools?.[0]?.function.name ?? "unknown_tool",
                  arguments: JSON.stringify({ query: "mock test query" }),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };

    const finalChunk = {
      id: "chatcmpl-mock-tool-stream",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    };

    res.write(`data: ${JSON.stringify(toolCallChunk)}\n\n`);

    setTimeout(() => {
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    }, 10);
  }

  private handleNonStreamingCompletion(request: OpenAICompletionRequest, res: http.ServerResponse): void {
    const response = {
      id: "chatcmpl-mock-" + String(Date.now()),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: this.response },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  private handleStreamingCompletion(request: OpenAICompletionRequest, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const chunks = this.response.split(" ");
    let index = 0;

    const sendChunk = (): void => {
      if (index < chunks.length) {
        const chunk = {
          id: "chatcmpl-mock-stream",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: request.model,
          choices: [
            {
              index: 0,
              delta: { content: (index > 0 ? " " : "") + (chunks[index] ?? "") },
              finish_reason: null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        index++;
        setTimeout(sendChunk, 10);
      } else {
        const finalChunk = {
          id: "chatcmpl-mock-stream",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: request.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    };

    sendChunk();
  }

  private readonly rot13DocCode = [
    "// Read the SKILL.md file for the rot13 skill",
    "const skillMd = fs.readFileSync('/skills/rot13/SKILL.md', 'utf8');",
    "return { skillMd };",
  ].join("\n");

  private readonly rot13Code = [
    "// Import and call the rot13 skill",
    "const { $rot13 } = await import('/skills/index.js');",
    'const result = await $rot13({ text: "Hello World" });',
    "return result;",
  ].join("\n");

  private readonly vfsCode = [
    "// List MCP servers exposed in the VFS",
    "const servers = fs.readdirSync('/servers');",
    "// Import and execute the mock MCP tool",
    "const { $mock_search } = await import('/servers/Mock_MCP/index.js');",
    "const mcpResult = await $mock_search({ query: 'test query' });",
    "// Write a file to the workspace and read it back",
    "fs.writeFileSync('/workspace/test.txt', 'VFS test content');",
    "const content = fs.readFileSync('/workspace/test.txt', 'utf8');",
    "return { servers, mcpResult, content };",
  ].join("\n");

  private getCodeForMessage(request: OpenAICompletionRequest): { code: string; reasoning: string } {
    const messageContent = this.getLastUserMessageContent(request);
    if (messageContent.includes("SKILL.md")) {
      return { code: this.rot13DocCode, reasoning: "Reading the SKILL.md documentation file" };
    } else if (messageContent.includes("rot13")) {
      return { code: this.rot13Code, reasoning: "Using the rot13 skill to encode the text" };
    } else if (messageContent.includes("vfs")) {
      return { code: this.vfsCode, reasoning: "Writing and reading a file in the VFS workspace" };
    } else {
      return { code: "", reasoning: "Unknown skill" };
    }
  }

  private handleNonStreamingCodeExecutionToolCall(request: OpenAICompletionRequest, res: http.ServerResponse): void {
    const { code, reasoning } = this.getCodeForMessage(request);

    const response = {
      id: "chatcmpl-mock-code-exec",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_code_exec_001",
                type: "function",
                function: {
                  name: "execute_code",
                  arguments: JSON.stringify({ code, reasoning }),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  private handleStreamingCodeExecutionToolCall(request: OpenAICompletionRequest, res: http.ServerResponse): void {
    const { code, reasoning } = this.getCodeForMessage(request);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const toolCallChunk = {
      id: "chatcmpl-mock-code-exec-stream",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                index: 0,
                id: "call_code_exec_001",
                type: "function",
                function: {
                  name: "execute_code",
                  arguments: JSON.stringify({ code, reasoning }),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };

    const finalChunk = {
      id: "chatcmpl-mock-code-exec-stream",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    };

    res.write(`data: ${JSON.stringify(toolCallChunk)}\n\n`);

    setTimeout(() => {
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    }, 10);
  }

  private getToolResultFromMessages(request: OpenAICompletionRequest): string {
    const toolMessages = request.messages?.filter((m) => m.role === "tool") ?? [];
    const lastToolMessage = toolMessages.at(-1);
    if (lastToolMessage && typeof lastToolMessage.content === "string") {
      return lastToolMessage.content;
    }
    return "No tool result found";
  }

  private handleNonStreamingCodeExecutionResponse(request: OpenAICompletionRequest, res: http.ServerResponse): void {
    const toolResult = this.getToolResultFromMessages(request);
    const responseContent = `Code execution completed. Here's the result:\n\n${toolResult}`;

    const response = {
      id: "chatcmpl-mock-code-exec-resp-" + String(Date.now()),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: responseContent },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  private handleStreamingCodeExecutionResponse(request: OpenAICompletionRequest, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const toolResult = this.getToolResultFromMessages(request);
    const responseContent = `Code execution completed. Here's the result:\n\n${toolResult}`;
    const chunks = responseContent.split(" ");
    let index = 0;

    const sendChunk = (): void => {
      if (index < chunks.length) {
        const chunk = {
          id: "chatcmpl-mock-code-exec-resp-stream",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: request.model,
          choices: [
            {
              index: 0,
              delta: { content: (index > 0 ? " " : "") + (chunks[index] ?? "") },
              finish_reason: null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        index++;
        setTimeout(sendChunk, 10);
      } else {
        const finalChunk = {
          id: "chatcmpl-mock-code-exec-resp-stream",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: request.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    };

    sendChunk();
  }

  private handleNonStreamingSkillToolCall(request: OpenAICompletionRequest, res: http.ServerResponse): void {
    const response = {
      id: "chatcmpl-mock-skill-tool",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_skill_001",
                type: "function",
                function: {
                  name: "skill_rot13",
                  arguments: JSON.stringify({ text: "Hello World" }),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  private handleStreamingSkillToolCall(request: OpenAICompletionRequest, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const toolCallChunk = {
      id: "chatcmpl-mock-skill-tool-stream",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                index: 0,
                id: "call_skill_001",
                type: "function",
                function: {
                  name: "skill_rot13",
                  arguments: JSON.stringify({ text: "Hello World" }),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };

    const finalChunk = {
      id: "chatcmpl-mock-skill-tool-stream",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    };

    res.write(`data: ${JSON.stringify(toolCallChunk)}\n\n`);

    setTimeout(() => {
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    }, 10);
  }

  private handleNonStreamingSkillToolResponse(request: OpenAICompletionRequest, res: http.ServerResponse): void {
    const toolResult = this.getToolResultFromMessages(request);
    const responseContent = `The ROT13 result is:\n\n${toolResult}`;

    const response = {
      id: "chatcmpl-mock-skill-resp",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: responseContent },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  private handleStreamingSkillToolResponse(request: OpenAICompletionRequest, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const toolResult = this.getToolResultFromMessages(request);
    const responseContent = `The ROT13 result is:\n\n${toolResult}`;
    const chunks = responseContent.split(" ");
    let index = 0;

    const sendChunk = (): void => {
      if (index < chunks.length) {
        const chunk = {
          id: "chatcmpl-mock-skill-resp-stream",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: request.model,
          choices: [
            {
              index: 0,
              delta: { content: (index > 0 ? " " : "") + (chunks[index] ?? "") },
              finish_reason: null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        index++;
        setTimeout(sendChunk, 10);
      } else {
        const finalChunk = {
          id: "chatcmpl-mock-skill-resp-stream",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: request.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    };

    sendChunk();
  }
}
