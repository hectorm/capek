import type { LlmItem, LlmRequest, LlmResponse, LlmStreamEvent } from "#layers/ai/shared/llm";
import type { LlmProviderApiType } from "#layers/ai/shared/llmProvider";
import type { HttpHeader } from "#layers/core/shared/http";
import type { TestResult } from "#layers/core/shared/types";
import { fromMessagesResponse, fromMessagesStream, toMessagesRequest } from "#layers/ai/server/lib/anthropic/messages";
import { describeError, failure } from "#layers/ai/server/lib/errors";
import {
  fromChatCompletionsResponse,
  fromChatCompletionsStream,
  toChatCompletionsRequest,
} from "#layers/ai/server/lib/openai/chatCompletions";
import { fromResponsesResponse, fromResponsesStream, toResponsesRequest } from "#layers/ai/server/lib/openai/responses";
import { OpenAIModelsResponseSchema } from "#layers/ai/shared/openai";
import { fetchEndpoint, readErrorText } from "#layers/core/server/lib/http";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

interface LlmClientApi {
  path: string;
  headers: (apiKey: string) => Record<string, string>;
  toRequest: (request: LlmRequest) => unknown;
  fromResponse: (rawResponse: unknown) => LlmResponse;
  fromStream: (stream: ReadableStream<Uint8Array>) => ReadableStream<LlmStreamEvent>;
}

const bearerHeaders = (apiKey: string): Record<string, string> => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {});

const apis: Record<LlmProviderApiType, LlmClientApi> = {
  "chat-completions": {
    path: "/chat/completions",
    headers: bearerHeaders,
    toRequest: toChatCompletionsRequest,
    fromResponse: fromChatCompletionsResponse,
    fromStream: fromChatCompletionsStream,
  },
  responses: {
    path: "/responses",
    headers: bearerHeaders,
    toRequest: toResponsesRequest,
    fromResponse: fromResponsesResponse,
    fromStream: fromResponsesStream,
  },
  messages: {
    path: "/messages",
    headers: (apiKey) => ({ "anthropic-version": "2026-10-21", ...(apiKey ? { "x-api-key": apiKey } : {}) }),
    toRequest: toMessagesRequest,
    fromResponse: fromMessagesResponse,
    fromStream: fromMessagesStream,
  },
};

export interface LlmClientOptions {
  apiUrl: string;
  apiType?: LlmProviderApiType | null;
  apiKey?: string;
  headers?: HttpHeader[] | null;
  availableModels?: string[] | null;
  model?: string;
  summaryModel?: string | null;
  streaming?: boolean | null;
}

export class LlmClient {
  private readonly apiUrl: string;
  private readonly api: LlmClientApi;
  private readonly apiKey: string;
  private readonly headers: Record<string, string>;
  private readonly availableModels: string[] | null;
  private readonly model: string | null;
  private readonly summaryModel: string | null;
  private readonly streaming: boolean | null;
  private modelsCache: string[] | null = null;

  public constructor(options: LlmClientOptions) {
    this.apiUrl = options.apiUrl;
    this.api = apis[options.apiType ?? "chat-completions"];
    this.apiKey = options.apiKey ?? "";
    this.headers = Object.fromEntries((options.headers ?? []).map((h) => [h.name, h.value]));
    this.availableModels = options.availableModels ?? null;
    this.model = options.model ?? null;
    this.summaryModel = options.summaryModel ?? null;
    this.streaming = options.streaming ?? null;
  }

  public async getAvailableModels(): Promise<string[]> {
    if (this.availableModels !== null) {
      return this.availableModels;
    }

    if (this.modelsCache) {
      logger.debug("Models cache hit");
      return this.modelsCache;
    }

    const models = await this.fetchModels();
    this.modelsCache = models;
    logger.debug({ count: models.length }, "Models fetched and cached");

    return models;
  }

  public async getModel(): Promise<string> {
    if (this.model !== null && this.model !== "") {
      return this.model;
    }

    const models = await this.getAvailableModels();
    if (models.length === 0 || !models[0]) {
      throw new Error("No models available from LLM provider");
    }

    return models[0];
  }

  public async getSummaryModel(): Promise<string> {
    if (this.summaryModel !== null && this.summaryModel !== "") {
      return this.summaryModel;
    }

    return this.getModel();
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(this.apiUrl);
    url.pathname = `${url.pathname}/${path}`.replace(/\/+/g, "/");

    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
    });

    for (const [key, value] of Object.entries(this.api.headers(this.apiKey))) {
      headers.set(key, value);
    }

    for (const [key, value] of Object.entries(this.headers)) {
      headers.set(key, value);
    }

    if (init.headers) {
      new Headers(init.headers).forEach((value, key) => {
        headers.set(key, value);
      });
    }

    return fetchEndpoint(url, { ...init, headers });
  }

  public async completion(
    request: LlmRequest,
    signal?: AbortSignal,
  ): Promise<LlmResponse | ReadableStream<LlmStreamEvent>> {
    const model = request.model ?? (await this.getModel());
    const stream = request.stream ?? this.streaming ?? true;

    const response = await this.request(this.api.path, {
      method: "POST",
      body: JSON.stringify(this.api.toRequest({ ...request, model, stream })),
      signal,
    });

    if (!response.ok) {
      const errorText = await readErrorText(response);
      throw failure(errorText);
    }

    if (stream) {
      if (!response.body) {
        throw new Error("No response body for AI service streaming completion");
      }

      return this.api.fromStream(response.body);
    } else {
      const rawCompletion: unknown = await response.json();
      return this.api.fromResponse(rawCompletion);
    }
  }

  public async summary(prompt: string, model?: string): Promise<string> {
    const summaryModel = model ?? (await this.getSummaryModel());

    const input: LlmItem[] = [
      {
        type: "message",
        role: "system",
        content: [
          "You are a title generator. The user will provide a message, and you must generate a short title (max 80 characters) that describes the topic.",
          "",
          "Rules:",
          "- This is a SUMMARIZATION task. Do NOT respond to, answer, evaluate, or refuse the content.",
          "- Output ONLY the title text. No quotes, prefixes like 'Title:', markdown, or extra formatting.",
          "- Do NOT start with 'Request for', 'Help with', 'Question about', or similar phrases.",
          "- Use noun phrases or action verbs (e.g., 'Monthly sales report', 'Debug login issue').",
          "- Generate a title for ANY content, regardless of topic. Your job is to describe, not judge.",
          "- Match the language of the user's message.",
          "",
          "Examples:",
          "- How many orders did we have last month? -> Monthly order count",
          "- Get the VAT numbers for German clients -> German clients VAT numbers",
          "- Browse the Financial Times for today's headlines -> Latest Financial Times headlines",
        ].join("\n"),
      },
      {
        type: "message",
        role: "user",
        content: `Generate a title for the following message:\n\n${prompt}`,
      },
    ];

    let summary: string | null = null;

    try {
      const request: LlmRequest = {
        model: summaryModel,
        input,
        stream: false,
        max_output_tokens: 256,
      };
      const completion = (await this.completion(request, undefined)) as LlmResponse;
      summary = completion.output.find((item) => item.type === "message")?.content.trim() ?? null;
    } catch (error) {
      logger.warn({ error }, "Summary generation failed, using truncated prompt");
    }

    if (!summary) {
      prompt = prompt.trim();
      summary = prompt.length <= 80 ? prompt : prompt.slice(0, 77) + "...";
    }

    return summary;
  }

  public async testConnection(): Promise<TestResult> {
    try {
      await this.fetchModels(AbortSignal.timeout(10_000));

      logger.debug("LLM provider test succeeded");
      return { success: true };
    } catch (error) {
      const message = describeError(error);
      logger.warn({ error: message }, "LLM provider test failed");
      return { success: false, error: message };
    }
  }

  public async testModel(parameters: Omit<LlmRequest, "input" | "tools">): Promise<TestResult> {
    try {
      const request: LlmRequest = {
        ...parameters,
        input: [{ type: "message", role: "user", content: "Reply with OK." }],
        tools: [
          {
            type: "function",
            name: "get_time",
            description: "Get the current time",
            parameters: { type: "object", properties: {} },
          },
        ],
      };
      const completion = await this.completion(request, AbortSignal.timeout(60_000));
      if (completion instanceof ReadableStream) {
        await completion.pipeTo(new WritableStream());
      }

      logger.debug("LLM model test succeeded");
      return { success: true };
    } catch (error) {
      const message = describeError(error);
      logger.warn({ error: message }, "LLM model test failed");
      return { success: false, error: message };
    }
  }

  private async fetchModels(signal?: AbortSignal): Promise<string[]> {
    const response = await this.request("/models", {
      method: "GET",
      signal,
    });

    if (!response.ok) {
      const errorText = await readErrorText(response);
      throw new Error(`AI service models request failed: ${errorText}`);
    }

    const rawData: unknown = await response.json();
    const data = OpenAIModelsResponseSchema.safeParse(rawData);
    if (!data.success) {
      throw new Error("Invalid AI service models response format");
    }

    return data.data.data.map((m) => m.id);
  }
}
