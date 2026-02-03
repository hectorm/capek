import type { HttpHeader } from "~~/shared/http";
import type { OpenAICompletionRequest, OpenAICompletionResponse, OpenAIMessage } from "~~/shared/openai";
import { useLogger } from "~~/server/lib/logger";
import { OpenAICompletionResponseSchema, OpenAIModelsResponseSchema } from "~~/shared/openai";

const logger = useLogger();

export interface OpenAIClientOptions {
  apiUrl: string;
  apiKey?: string;
  headers?: HttpHeader[] | null;
  availableModels?: string[] | null;
  model?: string;
  summaryModel?: string | null;
  streaming?: boolean | null;
}

export class OpenAIClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly headers: Record<string, string>;
  private readonly availableModels: string[] | null;
  private readonly model: string | null;
  private readonly summaryModel: string | null;
  private readonly streaming: boolean | null;
  private modelsCache: string[] | null = null;

  public constructor(options: OpenAIClientOptions) {
    this.apiUrl = options.apiUrl;
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

    if (this.apiKey) {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
    }

    for (const [key, value] of Object.entries(this.headers)) {
      headers.set(key, value);
    }

    if (init.headers) {
      new Headers(init.headers).forEach((value, key) => {
        headers.set(key, value);
      });
    }

    return fetch(url, { ...init, headers });
  }

  public async completion(
    request: OpenAICompletionRequest,
    signal?: AbortSignal,
  ): Promise<OpenAICompletionResponse | ReadableStream<Uint8Array>> {
    const model = request.model ?? (await this.getModel());

    const completionRequest = {
      ...request,
      model,
      stream: request.stream ?? this.streaming ?? true,
    } satisfies OpenAICompletionRequest & { stream: boolean; model: string };

    const response = await this.request("/chat/completions", {
      method: "POST",
      body: JSON.stringify(completionRequest),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI service completion request failed: ${errorText}`);
    }

    if (completionRequest.stream) {
      if (!response.body) {
        throw new Error("No response body for AI service streaming completion");
      }

      return response.body;
    } else {
      const rawCompletion: unknown = await response.json();
      const completion = OpenAICompletionResponseSchema.safeParse(rawCompletion);
      if (!completion.success) {
        throw new Error("Invalid AI service completion response format");
      }

      return completion.data;
    }
  }

  public async summary(prompt: string, model?: string): Promise<string> {
    const summaryModel = model ?? (await this.getSummaryModel());

    const messages: OpenAIMessage[] = [
      {
        role: "system",
        content: [
          "You are a title generator. The user will provide a message, and you must generate a short title (max 50 characters) that describes the topic.",
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
        role: "user",
        content: `Generate a title for the following message:\n\n${prompt}`,
      },
    ];

    let summary: string | null = null;

    try {
      const request: OpenAICompletionRequest = {
        model: summaryModel,
        messages,
        stream: false,
        max_completion_tokens: 256,
      };
      const completion = (await this.completion(request, undefined)) as OpenAICompletionResponse;
      summary = completion.choices[0]?.message.content?.trim() ?? null;
    } catch (error) {
      logger.warn({ error }, "Summary generation failed, using truncated prompt");
    }

    if (!summary) {
      prompt = prompt.trim();
      summary = prompt.length <= 50 ? prompt : prompt.slice(0, 47) + "...";
    }

    return summary;
  }

  private async fetchModels(): Promise<string[]> {
    const response = await this.request("/models", {
      method: "GET",
    });

    if (!response.ok) {
      const errorText = await response.text();
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
