import http from "node:http";

export interface MockLLMMessagesServerOptions {
  port: number;
  chatCompletionsUrl: string;
}

interface OpenAIToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface AnthropicMessagesBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicMessagesRequest {
  model: string;
  system?: string;
  messages?: { role: string; content: string | AnthropicMessagesBlock[] }[];
  stream?: boolean;
  output_config?: { effort?: string };
  tools?: { name: string; input_schema?: unknown }[];
}

export class MockLLMMessagesServer {
  private server: http.Server | null = null;
  private readonly port: number;
  private readonly chatCompletionsUrl: string;

  public constructor(options: MockLLMMessagesServerOptions) {
    this.port = options.port;
    this.chatCompletionsUrl = options.chatCompletionsUrl;
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on("error", reject);
      this.server.listen(this.port, () => {
        console.info(`Mock LLM Messages server listening on port ${String(this.port)}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.info("Mock LLM Messages server stopped");
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
      if (req.url === "/v1/messages") {
        void this.handleMessages(req, body, res);
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      }
    });
  }

  // The answer is the one that the mock of Chat Completions gives to the same conversation
  private async handleMessages(req: http.IncomingMessage, body: string, res: http.ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    let request: AnthropicMessagesRequest;
    try {
      request = JSON.parse(body) as AnthropicMessagesRequest;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const messages = (request.messages ?? []).flatMap((message) => {
      const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
      const text = blocks.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
      const toolCalls = blocks
        .filter((block) => block.type === "tool_use")
        .map((block) => ({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        }));
      const toolResults = blocks
        .filter((block) => block.type === "tool_result")
        .map((block) => ({ role: "tool", content: block.content ?? "", tool_call_id: block.tool_use_id }));

      return text || toolCalls.length > 0
        ? [...toolResults, { role: message.role, content: text || null, tool_calls: toolCalls }]
        : toolResults;
    });

    const completion = await fetch(`${this.chatCompletionsUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: request.system ? [{ role: "system", content: request.system }, ...messages] : messages,
        stream: request.stream,
        reasoning_effort: request.output_config?.effort,
        tools: request.tools?.map((tool) => ({
          type: "function",
          function: { name: tool.name, parameters: tool.input_schema },
        })),
      }),
    });

    if (request.stream) {
      await this.handleStreamingMessage(request, completion, res);
    } else {
      await this.handleNonStreamingMessage(request, completion, res);
    }
  }

  private async handleNonStreamingMessage(
    request: AnthropicMessagesRequest,
    completion: Response,
    res: http.ServerResponse,
  ): Promise<void> {
    const { choices } = (await completion.json()) as {
      choices: { message: { content: string | null; tool_calls?: OpenAIToolCall[] } }[];
    };
    const message = choices[0]?.message;

    const content: unknown[] = [];
    if (message?.content) {
      content.push({ type: "text", text: message.content });
    }
    for (const toolCall of message?.tool_calls ?? []) {
      content.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.function?.name,
        input: JSON.parse(toolCall.function?.arguments ?? "{}") as unknown,
      });
    }

    const response = {
      id: "msg-mock",
      type: "message",
      role: "assistant",
      model: request.model,
      content,
      stop_reason: message?.tool_calls?.length ? "tool_use" : "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  private async handleStreamingMessage(
    request: AnthropicMessagesRequest,
    completion: Response,
    res: http.ServerResponse,
  ): Promise<void> {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const message = {
      id: "msg-mock-stream",
      type: "message",
      role: "assistant",
      model: request.model,
      content: [],
      usage: { input_tokens: 10, output_tokens: 0 },
    };

    const send = (event: { type: string } & Record<string, unknown>): void => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    send({ type: "message_start", message });

    // Content blocks are numbered in the order they start, the text of the answer being one of them
    let blockCount = 0;
    let textIndex: number | null = null;
    const toolCallIndexes = new Map<number, number>();

    let buffer = "";
    const decoder = new TextDecoder();
    for await (const bytes of completion.body ?? []) {
      buffer += decoder.decode(bytes, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const data = block.replace(/^data: /, "");
        if (data === "[DONE]") {
          for (let index = 0; index < blockCount; index++) {
            send({ type: "content_block_stop", index });
          }
          const stopReason = toolCallIndexes.size > 0 ? "tool_use" : "end_turn";
          send({ type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 20 } });
          send({ type: "message_stop" });
          continue;
        }

        const chunk = JSON.parse(data) as {
          choices: { delta: { content?: string | null; tool_calls?: OpenAIToolCall[] } }[];
        };
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          if (textIndex === null) {
            textIndex = blockCount++;
            send({ type: "content_block_start", index: textIndex, content_block: { type: "text", text: "" } });
          }
          send({ type: "content_block_delta", index: textIndex, delta: { type: "text_delta", text: delta.content } });
        }

        for (const toolCall of delta?.tool_calls ?? []) {
          const index = toolCall.index ?? 0;
          let blockIndex = toolCallIndexes.get(index);
          if (blockIndex === undefined) {
            blockIndex = blockCount++;
            toolCallIndexes.set(index, blockIndex);
            const contentBlock = { type: "tool_use", id: toolCall.id, name: toolCall.function?.name, input: {} };
            send({ type: "content_block_start", index: blockIndex, content_block: contentBlock });
          }
          if (toolCall.function?.arguments) {
            const inputDelta = { type: "input_json_delta", partial_json: toolCall.function.arguments };
            send({ type: "content_block_delta", index: blockIndex, delta: inputDelta });
          }
        }
      }
    }

    res.end();
  }
}
