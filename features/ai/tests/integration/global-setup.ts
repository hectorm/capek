import { MockLLMChatCompletionsServer } from "./mocks/llm-chat-completions-server";
import { MockMCPServer } from "./mocks/mcp-server";

const globalSetup = async (): Promise<() => Promise<void>> => {
  const llmServer = new MockLLMChatCompletionsServer({ port: 51235 });
  const mcpServer = new MockMCPServer({ port: 51238 });
  const legacyMcpServer = new MockMCPServer({ port: 51239, modern: false });
  await Promise.all([llmServer.start(), mcpServer.start(), legacyMcpServer.start()]);

  return async () => {
    await Promise.all([llmServer.stop(), mcpServer.stop(), legacyMcpServer.stop()]);
  };
};

export default globalSetup;
