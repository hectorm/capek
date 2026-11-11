import http from "node:http";

export interface MockLLMResponsesServerOptions {
  port: number;
  chatCompletionsUrl: string;
}

interface OpenAIToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIResponsesRequest {
  model: string;
  input?: {
    type?: string;
    role?: string;
    content?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    output?: string;
  }[];
  stream?: boolean;
  reasoning?: { effort?: string };
  tools?: { type: string; name: string }[];
  tool_choice?: string;
}

export class MockLLMResponsesServer {
  private server: http.Server | null = null;
  private port: number;
  private chatCompletionsUrl: string;

  public constructor(options: MockLLMResponsesServerOptions) {
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
        console.info(`Mock LLM Responses server listening on port ${String(this.port)}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.info("Mock LLM Responses server stopped");
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
      if (req.url === "/v1/responses") {
        void this.handleResponses(req, body, res);
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      }
    });
  }

  // The answer is the one that the mock of Chat Completions gives to the same conversation
  private async handleResponses(req: http.IncomingMessage, body: string, res: http.ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    let request: OpenAIResponsesRequest;
    try {
      request = JSON.parse(body) as OpenAIResponsesRequest;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const messages = (request.input ?? []).map((item) => {
      if (item.type === "function_call") {
        const toolCall = {
          id: item.call_id,
          type: "function",
          function: { name: item.name, arguments: item.arguments },
        };
        return { role: "assistant", content: null, tool_calls: [toolCall] };
      }
      if (item.type === "function_call_output") {
        return { role: "tool", content: item.output ?? "", tool_call_id: item.call_id };
      }
      return { role: item.role ?? "user", content: item.content ?? "" };
    });

    const completion = await fetch(`${this.chatCompletionsUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages,
        stream: request.stream,
        reasoning_effort: request.reasoning?.effort,
        tools: request.tools?.map(({ type, ...tool }) => ({ type, function: tool })),
        tool_choice: request.tool_choice,
      }),
    });

    if (request.stream) await this.handleStreamingResponse(request, completion, res);
    else await this.handleNonStreamingResponse(request, completion, res);
  }

  private async handleNonStreamingResponse(
    request: OpenAIResponsesRequest,
    completion: Response,
    res: http.ServerResponse,
  ): Promise<void> {
    const { choices } = (await completion.json()) as {
      choices: { message: { content: string | null; tool_calls?: OpenAIToolCall[] } }[];
    };
    const message = choices[0]?.message;

    const output: unknown[] = [];
    if (message?.content) {
      output.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: message.content }] });
    }
    for (const toolCall of message?.tool_calls ?? []) {
      output.push({
        type: "function_call",
        call_id: toolCall.id,
        name: toolCall.function?.name,
        arguments: toolCall.function?.arguments,
      });
    }

    const response = {
      id: "resp-mock",
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      model: request.model,
      status: "completed",
      output,
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  private async handleStreamingResponse(
    request: OpenAIResponsesRequest,
    completion: Response,
    res: http.ServerResponse,
  ): Promise<void> {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const response = {
      id: "resp-mock-stream",
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      model: request.model,
      output: [],
    };

    const send = (event: { type: string } & Record<string, unknown>): void => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    send({ type: "response.created", response: { ...response, status: "in_progress" } });

    // Output items are numbered in the order they start, the text of the answer being one of them
    const output: unknown[] = [];
    let message: { index: number; part: { type: "output_text"; text: string } } | null = null;
    const toolCalls = new Map<
      number,
      { index: number; item: { type: "function_call"; call_id?: string; name?: string; arguments: string } }
    >();

    let buffer = "";
    const decoder = new TextDecoder();
    for await (const bytes of completion.body ?? []) {
      buffer += decoder.decode(bytes, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const data = block.replace(/^data: /, "");
        if (data === "[DONE]") {
          const usage = { input_tokens: 10, output_tokens: 20, total_tokens: 30 };
          send({ type: "response.completed", response: { ...response, status: "completed", output, usage } });
          continue;
        }

        const chunk = JSON.parse(data) as {
          choices: { delta: { content?: string | null; tool_calls?: OpenAIToolCall[] } }[];
        };
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          if (message === null) {
            message = { index: output.length, part: { type: "output_text", text: "" } };
            output.push({ type: "message", role: "assistant", content: [message.part] });
            const item = { type: "message", role: "assistant", content: [] };
            send({ type: "response.output_item.added", output_index: message.index, item });
          }
          message.part.text += delta.content;
          send({ type: "response.output_text.delta", output_index: message.index, delta: delta.content });
        }

        for (const toolCall of delta?.tool_calls ?? []) {
          const index = toolCall.index ?? 0;
          let started = toolCalls.get(index);
          if (started === undefined) {
            const item = {
              type: "function_call" as const,
              call_id: toolCall.id,
              name: toolCall.function?.name,
              arguments: "",
            };
            started = { index: output.length, item };
            toolCalls.set(index, started);
            output.push(item);
            send({ type: "response.output_item.added", output_index: started.index, item });
          }
          if (toolCall.function?.arguments) {
            const argumentsDelta = toolCall.function.arguments;
            started.item.arguments += argumentsDelta;
            send({
              type: "response.function_call_arguments.delta",
              output_index: started.index,
              delta: argumentsDelta,
            });
          }
        }
      }
    }

    res.end();
  }
}
