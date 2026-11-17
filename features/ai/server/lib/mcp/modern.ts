import { Buffer } from "node:buffer";

import { z } from "zod/v4";

import type {
  MCPCallOptions,
  MCPConnection,
  MCPConnectionOptions,
  MCPToolList,
} from "#layers/ai/server/lib/mcp/connection";
import type { MCPCallToolResult, MCPTool } from "#layers/ai/shared/mcp";
import { CLIENT_INFO, PROTOCOL_VERSIONS, requestTools } from "#layers/ai/server/lib/mcp/connection";
import { MCPRequestError, request } from "#layers/ai/server/lib/mcp/http";
import { MCPCallToolResultSchema } from "#layers/ai/shared/mcp";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

const UNSUPPORTED_PROTOCOL_VERSION = -32022;
const PROTOCOL_ERRORS = [-32020, -32021, UNSUPPORTED_PROTOCOL_VERSION];

const PARAM_HEADER_KEYWORD = "x-mcp-header";
const PARAM_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const PARAM_HEADER_TYPES = ["string", "integer", "boolean", "null"];

const VersionsSchema = z.array(z.string()).catch([]);

const ResultSchema = z.looseObject({
  resultType: z.string().default("complete"),
});

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isLegacyAnswer = (error: MCPRequestError): boolean => {
  const understood = error.code !== null && PROTOCOL_ERRORS.includes(error.code);
  return !understood && error.status < 500 && error.status !== 401 && error.status !== 403;
};

const headerValue = (value: string): string => {
  const plain = /^[\x21-\x7E]([\x20-\x7E\t]*[\x21-\x7E])?$/.test(value) || value === "";
  const encoded = value.startsWith("=?base64?") && value.endsWith("?=");
  return plain && !encoded ? value : `=?base64?${Buffer.from(value, "utf8").toString("base64")}?=`;
};

interface ParamHeader {
  name: string;
  path: string[];
}

const findParamHeaders = (inputSchema: unknown): ParamHeader[] => {
  const found: ParamHeader[] = [];

  const visit = (schema: unknown, path: string[] | null): void => {
    if (Array.isArray(schema)) {
      for (const item of schema) {
        visit(item, null);
      }
      return;
    }
    if (!isObject(schema)) {
      return;
    }

    for (const [keyword, value] of Object.entries(schema)) {
      if (keyword === PARAM_HEADER_KEYWORD) {
        const types: unknown[] = [schema.type].flat();
        if (
          typeof value !== "string" ||
          !PARAM_HEADER_NAME.test(value) ||
          !path?.length ||
          !types.every((type) => typeof type === "string" && PARAM_HEADER_TYPES.includes(type)) ||
          found.some((header) => header.name.toLowerCase() === value.toLowerCase())
        ) {
          throw new Error(`The "${PARAM_HEADER_KEYWORD}" of the parameter "${path?.join(".") ?? ""}" is not valid`);
        }
        found.push({ name: value, path });
      } else if (keyword === "properties" && path && isObject(value)) {
        for (const [key, property] of Object.entries(value)) {
          visit(property, [...path, key]);
        }
      } else {
        visit(value, null);
      }
    }
  };
  visit(inputSchema, []);

  return found;
};

const paramHeaders = (tool: MCPTool, args: Record<string, unknown>): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const { name, path } of findParamHeaders(tool.inputSchema)) {
    let value: unknown = args;
    for (const key of path) {
      value = isObject(value) && Object.hasOwn(value, key) ? value[key] : undefined;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      headers[`Mcp-Param-${name}`] = headerValue(String(value));
    }
  }
  return headers;
};

export class ModernConnection implements MCPConnection {
  private readonly name: string;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number | undefined;
  private readonly protocolVersion: string;

  private constructor(options: MCPConnectionOptions, protocolVersion: string) {
    this.name = options.name;
    this.url = options.url;
    this.headers = Object.fromEntries(options.headers.map((h) => [h.name, h.value]));
    this.timeoutMs = options.timeoutMs;
    this.protocolVersion = protocolVersion;
  }

  public static async open(options: MCPConnectionOptions): Promise<ModernConnection | null> {
    let supported: unknown;
    try {
      const preferred = new ModernConnection(options, PROTOCOL_VERSIONS.modern[0]);
      supported = (await preferred.rpc("server/discover", {}, { signal: options.signal })).supportedVersions;
    } catch (error) {
      if (!(error instanceof MCPRequestError)) {
        throw error;
      }
      if (error.code === UNSUPPORTED_PROTOCOL_VERSION) {
        supported = isObject(error.data) ? error.data.supported : undefined;
      } else if (!isLegacyAnswer(error)) {
        throw error;
      }
    }

    const versions = VersionsSchema.parse(supported);
    const protocolVersion = PROTOCOL_VERSIONS.modern.find((version) => versions.includes(version));
    if (!protocolVersion) {
      return null;
    }

    logger.debug({ serverName: options.name, url: options.url, protocolVersion }, "MCP server discovered");
    return new ModernConnection(options, protocolVersion);
  }

  private async rpc(
    method: string,
    params: Record<string, unknown>,
    options: MCPCallOptions = {},
    extraHeaders: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const headers = new Headers({
      ...this.headers,
      ...extraHeaders,
      "MCP-Protocol-Version": this.protocolVersion,
      "Mcp-Method": method,
    });

    const { result } = await request(
      this.url,
      method,
      {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": this.protocolVersion,
          "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
      { headers, signal: options.signal, timeoutMs: options.timeoutMs ?? this.timeoutMs },
    );

    const parsed = ResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new Error("The MCP server did not send a valid result");
    }
    if (parsed.data.resultType !== "complete") {
      throw new Error(`The MCP server sent a result of the type "${parsed.data.resultType}", which is not supported`);
    }
    return parsed.data;
  }

  public async listTools(options: MCPCallOptions = {}): Promise<MCPToolList> {
    const listed = await requestTools((params) => this.rpc("tools/list", params, options));

    const tools = listed.tools.filter((tool) => {
      try {
        findParamHeaders(tool.inputSchema);
        return true;
      } catch (error) {
        logger.warn({ serverName: this.name, toolName: tool.name, error }, "MCP tool ignored");
        return false;
      }
    });

    logger.debug({ serverName: this.name, toolCount: tools.length }, "MCP tools listed");
    return { tools, ttlMs: listed.ttlMs };
  }

  public async callTool(
    tool: MCPTool,
    args: Record<string, unknown>,
    options: MCPCallOptions = {},
  ): Promise<MCPCallToolResult> {
    const rawResult = await this.rpc("tools/call", { name: tool.name, arguments: args }, options, {
      ...paramHeaders(tool, args),
      "Mcp-Name": headerValue(tool.name),
    });
    const result = MCPCallToolResultSchema.parse(rawResult);
    logger.debug({ serverName: this.name, toolName: tool.name }, "MCP tool called");
    return result;
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }
}
