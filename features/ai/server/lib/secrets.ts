import type { HttpHeader } from "#layers/core/shared/http";
import { useSecrets } from "#layers/core/server/lib/secrets";

const LLM_PROVIDER_API_KEY_CONTEXT = "ai_llm_providers.api_key";
const LLM_PROVIDER_HEADERS_CONTEXT = "ai_llm_providers.headers";
const MCP_SERVER_HEADERS_CONTEXT = "ai_mcp_servers.headers";

interface LlmProviderSecrets {
  apiKey: string;
  headers: HttpHeader[];
}

interface StoredLlmProviderSecrets {
  apiKey: string;
  headers: string;
}

export const encryptLlmProviderSecrets = (values: LlmProviderSecrets): StoredLlmProviderSecrets => {
  return {
    apiKey: useSecrets().encrypt(values.apiKey, LLM_PROVIDER_API_KEY_CONTEXT),
    headers: useSecrets().encrypt(JSON.stringify(values.headers), LLM_PROVIDER_HEADERS_CONTEXT),
  };
};

export const decryptLlmProviderSecrets = (stored: StoredLlmProviderSecrets): LlmProviderSecrets => {
  return {
    apiKey: useSecrets().decrypt(stored.apiKey, LLM_PROVIDER_API_KEY_CONTEXT),
    headers: JSON.parse(useSecrets().decrypt(stored.headers, LLM_PROVIDER_HEADERS_CONTEXT)) as HttpHeader[],
  };
};

export const encryptMcpServerHeaders = (headers: HttpHeader[]): string => {
  return useSecrets().encrypt(JSON.stringify(headers), MCP_SERVER_HEADERS_CONTEXT);
};

export const decryptMcpServerHeaders = (headers: string): HttpHeader[] => {
  return JSON.parse(useSecrets().decrypt(headers, MCP_SERVER_HEADERS_CONTEXT)) as HttpHeader[];
};
