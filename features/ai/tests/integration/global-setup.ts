import { MockLLMChatCompletionsServer } from "./mocks/llm-chat-completions-server";
import { MockLLMMessagesServer } from "./mocks/llm-messages-server";
import { MockLLMResponsesServer } from "./mocks/llm-responses-server";
import { MockMCPServer } from "./mocks/mcp-server";

let llmChatCompletionsServer: MockLLMChatCompletionsServer | null = null;
let llmResponsesServer: MockLLMResponsesServer | null = null;
let llmMessagesServer: MockLLMMessagesServer | null = null;
let mcpServer: MockMCPServer | null = null;

async function globalSetup(): Promise<() => Promise<void>> {
  console.info("Starting mock servers...");

  llmChatCompletionsServer = new MockLLMChatCompletionsServer({ port: 51235 });
  llmResponsesServer = new MockLLMResponsesServer({ port: 51236, chatCompletionsUrl: "http://localhost:51235/v1" });
  llmMessagesServer = new MockLLMMessagesServer({ port: 51237, chatCompletionsUrl: "http://localhost:51235/v1" });
  mcpServer = new MockMCPServer({ port: 51238 });

  await Promise.all([
    llmChatCompletionsServer.start(),
    llmResponsesServer.start(),
    llmMessagesServer.start(),
    mcpServer.start(),
  ]);
  console.info("Mock servers started successfully");

  return async () => {
    console.info("Stopping mock servers...");
    await Promise.all([
      llmChatCompletionsServer?.stop(),
      llmResponsesServer?.stop(),
      llmMessagesServer?.stop(),
      mcpServer?.stop(),
    ]);
    console.info("Mock servers stopped");
  };
}

export default globalSetup;
