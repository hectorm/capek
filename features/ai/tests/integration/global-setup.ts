import { MockLLMServer } from "./mocks/llm-server";
import { MockMCPServer } from "./mocks/mcp-server";

let llmServer: MockLLMServer | null = null;
let mcpServer: MockMCPServer | null = null;

async function globalSetup(): Promise<() => Promise<void>> {
  console.info("Starting mock servers...");

  llmServer = new MockLLMServer({ port: 51235 });
  mcpServer = new MockMCPServer({ port: 51236 });

  await Promise.all([llmServer.start(), mcpServer.start()]);
  console.info("Mock servers started successfully");

  return async () => {
    console.info("Stopping mock servers...");
    await Promise.all([llmServer?.stop(), mcpServer?.stop()]);
    console.info("Mock servers stopped");
  };
}

export default globalSetup;
