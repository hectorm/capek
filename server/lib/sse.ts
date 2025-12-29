import { useLogger } from "~~/server/lib/logger";

const logger = useLogger();

export interface SSEEvent {
  data: string;
  eventId: string | null;
  eventType: string | null;
}

export interface SSEProcessorOptions {
  onEvent: (event: SSEEvent) => void;
  onRetry?: (retryMs: number) => void;
}

export class SSEProcessor {
  private buffer = "";
  private currentEventId: string | null = null;
  private currentEventType: string | null = null;
  private currentData: string[] = [];
  private readonly decoder = new TextDecoder();
  private readonly onEvent: (event: SSEEvent) => void;
  private readonly onRetry?: (retryMs: number) => void;

  public constructor(options: SSEProcessorOptions) {
    this.onEvent = options.onEvent;
    this.onRetry = options.onRetry;
  }

  public process(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      this.processLine(line);
    }
  }

  public flush(): void {
    if (this.buffer) {
      this.processLine(this.buffer);
      this.buffer = "";
    }
    this.dispatchEvent();
  }

  private processLine(line: string): void {
    if (line === "" || line === "\r") {
      this.dispatchEvent();
      return;
    }

    if (line.startsWith(":")) {
      return;
    }

    const colonIndex = line.indexOf(":");
    let field: string;
    let value: string;

    if (colonIndex === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colonIndex);
      value = line.slice(colonIndex + 1);
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }
    }

    if (value.endsWith("\r")) {
      value = value.slice(0, -1);
    }
    if (field.endsWith("\r")) {
      field = field.slice(0, -1);
    }

    switch (field) {
      case "data":
        this.currentData.push(value);
        break;
      case "id":
        if (!value.includes("\0")) {
          this.currentEventId = value;
        }
        break;
      case "event":
        this.currentEventType = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) {
          const retryMs = parseInt(value, 10);
          if (this.onRetry) {
            this.onRetry(retryMs);
          }
        }
        break;
    }
  }

  private dispatchEvent(): void {
    if (this.currentData.length === 0) {
      this.currentEventType = null;
      return;
    }

    const data = this.currentData.join("\n");
    this.currentData = [];

    const eventType = this.currentEventType;
    this.currentEventType = null;

    if (data === "[DONE]") {
      return;
    }

    try {
      this.onEvent({
        data,
        eventId: this.currentEventId,
        eventType,
      });
    } catch (error) {
      logger.debug({ data, eventId: this.currentEventId, eventType, error }, "SSE event callback error");
    }
  }
}
