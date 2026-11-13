import { MockLLMChatCompletionsServer } from "./mocks/llm-chat-completions-server";
import { MockMCPServer } from "./mocks/mcp-server";

async function globalSetup(): Promise<() => Promise<void>> {
  const llmServer = new MockLLMChatCompletionsServer({ port: 51235 });
  const mcpServer = new MockMCPServer({ port: 51238 });
  await Promise.all([llmServer.start(), mcpServer.start()]);

  return async () => {
    await Promise.all([llmServer.stop(), mcpServer.stop()]);
  };
}

export default globalSetup;
