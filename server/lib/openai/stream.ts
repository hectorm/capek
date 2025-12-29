import type { OpenAIStreamChunk, OpenAIToolCall } from "~~/shared/openai";
import { useLogger } from "~~/server/lib/logger";
import { OpenAIStreamChunkSchema } from "~~/shared/openai";

const logger = useLogger();

export class OpenAIStreamProcessor {
  private id = "";
  private content = "";
  private toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

  public getId(): string {
    return this.id;
  }

  public getContent(): string {
    return this.content;
  }

  public getToolCalls(): OpenAIToolCall[] {
    return Array.from(this.toolCalls.values()).map((tc) => ({
      id: tc.id,
      type: "function",
      function: {
        name: tc.name,
        arguments: tc.arguments,
      },
    }));
  }

  public hasToolCalls(): boolean {
    return this.toolCalls.size > 0;
  }

  public parseChunk(data: string): OpenAIStreamChunk | null {
    try {
      const rawChunk: unknown = JSON.parse(data);
      const result = OpenAIStreamChunkSchema.safeParse(rawChunk);
      if (!result.success) {
        logger.debug({ data, error: result.error }, "Invalid OpenAI chunk");
        return null;
      }
      return result.data;
    } catch (error) {
      logger.debug({ data, error }, "OpenAI chunk parse error");
      return null;
    }
  }

  public processChunk(chunk: OpenAIStreamChunk): void {
    if (!this.id && chunk.id) {
      this.id = chunk.id;
    }

    const choice = chunk.choices.at(0);
    if (!choice) return;

    const delta = choice.delta;
    if (delta.content) {
      this.content += delta.content;
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const index = tc.index ?? 0;
        const existing = this.toolCalls.get(index);

        if (tc.id && tc.type === "function" && tc.function?.name) {
          this.toolCalls.set(index, {
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments ?? "",
          });
        } else if (existing && tc.function?.arguments) {
          existing.arguments += tc.function.arguments;
        }
      }
    }
  }

  public reset(): void {
    this.id = "";
    this.content = "";
    this.toolCalls.clear();
  }
}
