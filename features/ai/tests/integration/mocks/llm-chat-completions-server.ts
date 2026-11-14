import http from "node:http";
import { setTimeout } from "node:timers";

export interface MockLLMChatCompletionsServerOptions {
  port: number;
}

interface OpenAICompletionRequest {
  model: string;
  messages?: { role: string; content: string | null }[];
  stream?: boolean;
  tools?: { type: string; function: { name: string; parameters?: unknown } }[];
}

interface MockAnswer {
  content?: string;
  toolCall?: { name: string; arguments: Record<string, unknown> };
  endDelay?: number;
}

const RESPONSE = "This is a mock response";
const PARTIAL_RESPONSE = "Partial answer before cutoff";

const CODE = [
  "const skill = fs.readFileSync('/skills/rot13/SKILL.md', 'utf8');",
  "const { $rot13 } = await import('/skills/index.js');",
  "const rot13 = await $rot13({ text: 'Hello World' });",
  "const servers = fs.readdirSync('/servers');",
  "const { $mock_search } = await import('/servers/Mock_MCP/index.js');",
  "const search = await $mock_search({ query: 'test query' });",
  "fs.writeFileSync('/workspace/test.txt', 'VFS test content');",
  "const file = fs.readFileSync('/workspace/test.txt', 'utf8');",
  "return { skill, rot13, servers, search, file };",
].join("\n");

// Answers with a call to the tool named in the last message, or the first one, and then with the result of that call
export class MockLLMChatCompletionsServer {
  private server: http.Server | null = null;
  private readonly port: number;

  public constructor(options: MockLLMChatCompletionsServerOptions) {
    this.port = options.port;
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on("error", reject);
      this.server.listen(this.port, () => {
        console.info(`Mock LLM Chat Completions server listening on port ${String(this.port)}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.info("Mock LLM Chat Completions server stopped");
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
      if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      const request = JSON.parse(body) as OpenAICompletionRequest;
      this.send(res, request, this.answer(request));
    });
  }

  private answer(request: OpenAICompletionRequest): MockAnswer {
    const tools = request.tools ?? [];
    const messages = request.messages ?? [];
    const message = messages.findLast((m) => m.role === "user")?.content ?? "";
    const lastMessage = messages.at(-1);

    const route = tools.find((candidate) => candidate.function.name === "route_to_specialist");
    if (route) {
      const parameters = route.function.parameters as { properties: { specialistId: { enum: string[] } } };
      const specialistId = parameters.properties.specialistId.enum[0];
      return { toolCall: { name: route.function.name, arguments: { specialistId, routingReason: "Testing" } } };
    }

    const tool = tools.find((candidate) => message.includes(candidate.function.name)) ?? tools[0];
    if (!tool || lastMessage?.role === "tool") {
      const content = lastMessage?.role === "tool" ? `${RESPONSE}\n\n${lastMessage.content ?? ""}` : RESPONSE;
      return { content, endDelay: message.includes("end slowly") ? 5000 : 10 };
    }

    if (message.includes("iteration limit")) {
      return { content: PARTIAL_RESPONSE, toolCall: { name: tool.function.name, arguments: { text: "hello" } } };
    }

    return { toolCall: { name: tool.function.name, arguments: this.toolArguments(tool.function.name, message) } };
  }

  private toolArguments(name: string, message: string): Record<string, unknown> {
    switch (name) {
      case "ai_chart":
        return {
          name: "mock-chart",
          option: message.includes("3D")
            ? { grid3D: {}, xAxis3D: {}, yAxis3D: {}, zAxis3D: {}, series: [{ type: "bar3D", data: [[1, 2, 3]] }] }
            : { xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ type: "bar", data: [1, 2] }] },
        };
      case "ai_table":
        return {
          name: "mock-table",
          columns: ["name", "total"],
          rows: Array.from({ length: 150 }, (_, index) => [`item ${String(index + 1)}`, index + 1]),
        };
      case "execute_code":
        return { code: CODE, reasoning: "Testing" };
      case "skill_rot13":
        return { text: "Hello World" };
      default:
        return { query: "mock test query" };
    }
  }

  private send(res: http.ServerResponse, request: OpenAICompletionRequest, answer: MockAnswer): void {
    const toolCalls = answer.toolCall && [
      {
        index: 0,
        id: "call_mock",
        type: "function",
        function: { name: answer.toolCall.name, arguments: JSON.stringify(answer.toolCall.arguments) },
      },
    ];
    const finishReason = toolCalls ? "tool_calls" : "stop";
    const base = { id: "chatcmpl-mock", created: Math.floor(Date.now() / 1000), model: request.model };

    if (!request.stream) {
      const message = { role: "assistant", content: answer.content ?? null, tool_calls: toolCalls };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ...base,
          object: "chat.completion",
          choices: [{ index: 0, message, finish_reason: finishReason }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      );
      return;
    }

    const words = answer.content?.split(" ") ?? [];
    const deltas = [
      ...words.map((word, index) => ({ content: index > 0 ? ` ${word}` : word })),
      ...(toolCalls ? [{ tool_calls: toolCalls }] : []),
    ];
    const chunk = (delta: object, finish: string | null): string => {
      const data = { ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] };
      return `data: ${JSON.stringify(data)}\n\n`;
    };

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const write = (index: number): void => {
      const delta = deltas[index];
      if (delta) {
        res.write(chunk(delta, null));
        setTimeout(
          () => {
            write(index + 1);
          },
          index < deltas.length - 1 ? 10 : (answer.endDelay ?? 10),
        );
      } else {
        res.end(`${chunk({}, finishReason)}data: [DONE]\n\n`);
      }
    };
    write(0);
  }
}
