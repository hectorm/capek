import type { OpenAIClientOptions } from "~~/server/lib/openai/client";
import { useLogger } from "~~/server/lib/logger";
import { OpenAIClient } from "~~/server/lib/openai/client";

const logger = useLogger();

export class OpenAIManager {
  private static instance: OpenAIManager | null = null;
  private clients = new Map<string, OpenAIClient>();

  private constructor() {}

  static getInstance(): OpenAIManager {
    return (OpenAIManager.instance ??= new OpenAIManager());
  }

  public getClient(clientId: string): OpenAIClient {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error(`OpenAI client not found: ${clientId}`);
    }

    return client;
  }

  public getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  public hasClient(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  public addClient(clientId: string, options: OpenAIClientOptions): OpenAIClient {
    const client = new OpenAIClient(options);
    this.clients.set(clientId, client);
    logger.debug({ clientId }, "OpenAI client added");
    return client;
  }

  public removeClient(clientId: string): void {
    this.clients.delete(clientId);
    logger.debug({ clientId }, "OpenAI client removed");
  }
}
