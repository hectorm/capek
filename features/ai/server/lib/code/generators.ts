import type { AgentToolset } from "#layers/ai/server/lib/tools";
import type { MCPTool } from "#layers/ai/shared/mcp";
import type { OpenAIFunctionParameters } from "#layers/ai/shared/openai";
import type { Tool } from "#layers/core/server/lib/tools/define";
import type { HttpHeader } from "#layers/core/shared/http";
import { VirtualFileSystem } from "#layers/ai/server/lib/code/vfs";

export interface MCPServerBinding {
  id: string;
  name: string;
  url: string;
  headers: HttpHeader[];
  stateful: boolean;
  toolCallTimeoutSec: number | null;
  tools: MCPTool[];
}

export interface SkillBinding {
  id: string;
  name: string;
  description: string;
  documentation: string | null;
  parameters: OpenAIFunctionParameters;
  code: string | null;
}

export function createVFS(
  servers: MCPServerBinding[],
  skills: SkillBinding[],
  toolsets: AgentToolset[] = [],
): VirtualFileSystem {
  const vfs = new VirtualFileSystem();

  const serverExports: string[] = [];
  for (const server of servers) {
    const serverName = sanitizeId(server.name);
    const toolExports: string[] = [];

    for (const tool of server.tools) {
      const toolName = sanitizeId(tool.name);
      const toolPath = `/servers/${serverName}/${toolName}.js`;
      vfs.writeFile(toolPath, generateToolModule(server.name, tool), { readonly: true });

      toolExports.push(
        `${briefComment(tool.description, tool.name)}\nexport { default as $${toolName} } from "./${toolName}.js";`,
      );
    }

    vfs.writeFile(`/servers/${serverName}/index.js`, toolExports.join("\n\n") + "\n", { readonly: true });
    serverExports.push(`export * from "./${serverName}/index.js";`);
  }
  vfs.writeFile("/servers/index.js", serverExports.join("\n") + "\n", { readonly: true });

  const skillExports: string[] = [];
  for (const skill of skills) {
    const skillName = sanitizeId(skill.name);

    const skillMd = generateSkillMarkdown(skill);
    vfs.writeFile(`/skills/${skillName}/SKILL.md`, skillMd, { readonly: true });

    if (skill.code) {
      vfs.writeFile(`/skills/${skillName}/scripts/main.js`, skill.code, { readonly: true });

      skillExports.push(
        `${briefComment(skill.description, skill.name)}\nexport { default as $${skillName} } from "./${skillName}/scripts/main.js";`,
      );
    }
  }
  vfs.writeFile("/skills/index.js", skillExports.join("\n\n") + "\n", { readonly: true });

  if (toolsets.length > 0) {
    const toolsetExports: string[] = [];
    for (const toolset of toolsets) {
      const provider = sanitizeId(toolset.provider);
      const toolExports: string[] = [];

      for (const tool of toolset.tools) {
        const toolName = sanitizeId(tool.name);
        vfs.writeFile(`/tools/${provider}/${toolName}.js`, generateFeatureToolModule(tool), { readonly: true });

        toolExports.push(
          `${briefComment(tool.description, tool.name)}\nexport { default as $${toolName} } from "./${toolName}.js";`,
        );
      }
      vfs.writeFile(`/tools/${provider}/index.js`, toolExports.join("\n\n") + "\n", { readonly: true });

      if (toolset.instructions) {
        vfs.writeFile(`/tools/${provider}/README.md`, toolset.instructions, { readonly: true });
      }
      for (const [name, content] of Object.entries(toolset.documents ?? {})) {
        const fileName = name.replace(/[^a-zA-Z0-9_.-]/g, "_");
        vfs.writeFile(`/tools/${provider}/docs/${fileName}`, content, { readonly: true });
      }

      toolsetExports.push(`export * from "./${provider}/index.js";`);
    }
    vfs.writeFile("/tools/index.js", toolsetExports.join("\n") + "\n", { readonly: true });
  }

  return vfs;
}

function generateFeatureToolModule(tool: Tool): string {
  const jsdoc = generateJSDoc(tool.name, tool.description, tool.parameters);
  return [
    jsdoc,
    "export default async function (params) {",
    `  const result = await __toolCall(${JSON.stringify(tool.name)}, JSON.stringify(params || {}));`,
    "  try { return JSON.parse(result); } catch { return result; }",
    "}",
  ].join("\n");
}

function generateToolModule(serverName: string, tool: MCPTool): string {
  const jsdoc = generateJSDoc(tool.name, tool.description ?? "", tool.inputSchema);
  return [
    jsdoc,
    "export default function (params) {",
    `  const result = __mcpCall(${JSON.stringify(serverName)}, ${JSON.stringify(tool.name)}, JSON.stringify(params || {}));`,
    "  try { return JSON.parse(result); } catch { return result; }",
    "}",
  ].join("\n");
}

function generateSkillMarkdown(skill: SkillBinding): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`name: ${skill.name}`);
  lines.push(`description: ${skill.description}`);
  lines.push("---");
  lines.push("");

  if (skill.documentation) {
    lines.push(skill.documentation);
  } else {
    lines.push(`# ${skill.name}`);
    lines.push("");
    lines.push(skill.description || "No description available.");
  }

  if (skill.code) {
    lines.push("");
    lines.push("## Usage");
    lines.push("");
    lines.push("```js");
    lines.push(`const { $${sanitizeId(skill.name)} } = await import('/skills/index.js');`);
    lines.push(`await $${sanitizeId(skill.name)}({ /* params */ });`);
    lines.push("```");
  }

  return lines.join("\n");
}

function sanitizeId(name: string): string {
  let id = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (id.length === 0) id = "_unnamed";
  return id;
}

interface ToolInputSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
}

function escapeJSDoc(text: string): string {
  return text.replace(/\/\*/g, "/ *").replace(/\*\//g, "* /");
}

function briefComment(description: string | undefined, name: string): string {
  const firstLine = description?.split("\n")[0]?.slice(0, 100);
  const brief = firstLine === undefined || firstLine === "" ? name : firstLine;
  return `/** ${escapeJSDoc(brief)} */`;
}

function generateJSDoc(name: string, description: string, schema: ToolInputSchema): string {
  const lines: string[] = [];

  if (description) {
    lines.push(...wrapText(description, 77));
  } else {
    lines.push(name);
  }
  lines.push("");

  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  if (Object.keys(properties).length > 0) {
    lines.push("@param {Object} params");
    for (const [propName, propSchema] of Object.entries(properties)) {
      const info = extractPropInfo(propSchema);
      const opt = required.has(propName) ? "" : " (optional)";
      lines.push(`@param {${info.type}} params.${propName}${opt}`);

      if (info.description) {
        for (const line of wrapText(info.description, 70)) {
          lines.push(`  ${line}`);
        }
      }
      if (info.enumValues?.length) {
        lines.push(`  Allowed: ${info.enumValues.map((v) => `"${v}"`).join(", ")}`);
      }
      if (info.defaultValue !== undefined) {
        lines.push(`  Default: ${JSON.stringify(info.defaultValue)}`);
      }
    }
  } else {
    lines.push("@param {Object} params - No parameters required");
  }

  lines.push("@returns {*} Tool result");

  return ["/**", ...lines.map((line) => ` * ${escapeJSDoc(line)}`.trimEnd()), " */"].join("\n");
}

interface PropInfo {
  type: string;
  description: string | null;
  enumValues: string[] | null;
  defaultValue: unknown;
}

function extractPropInfo(schema: unknown): PropInfo {
  if (!schema || typeof schema !== "object") {
    return { type: "*", description: null, enumValues: null, defaultValue: undefined };
  }

  const s = schema as Record<string, unknown>;
  return {
    type: schemaToType(s),
    description: typeof s.description === "string" ? s.description : null,
    enumValues: Array.isArray(s.enum) ? s.enum.filter((v): v is string => typeof v === "string") : null,
    defaultValue: s.default,
  };
}

function schemaToType(s: Record<string, unknown>): string {
  if (Array.isArray(s.enum) && s.enum.length <= 5) {
    return s.enum.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join("|");
  }

  switch (s.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      if (s.items && typeof s.items === "object") {
        return `Array<${schemaToType(s.items as Record<string, unknown>)}>`;
      }
      return "Array";
    case "object":
      if (s.properties && typeof s.properties === "object") {
        const props = s.properties as Record<string, unknown>;
        const req = new Set((s.required as string[] | undefined) ?? []);
        const entries = Object.entries(props).slice(0, 4);
        if (entries.length > 0 && entries.length <= 4) {
          const propTypes = entries.map(([k, v]) => {
            const opt = req.has(k) ? "" : "?";
            return `${k}${opt}: ${schemaToType(v as Record<string, unknown>)}`;
          });
          return `{ ${propTypes.join(", ")} }`;
        }
      }
      return "Object";
  }

  if (Array.isArray(s.oneOf) || Array.isArray(s.anyOf)) {
    const variants = (s.oneOf ?? s.anyOf) as Record<string, unknown>[];
    const types = [...new Set(variants.filter((v) => typeof v === "object").map((v) => schemaToType(v)))];
    return types.length <= 3 ? types.join("|") : "*";
  }

  return "*";
}

function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n\n+/)) {
    const normalized = para.replace(/\s+/g, " ").trim();
    if (!normalized) continue;

    let line = "";
    for (const word of normalized.split(" ")) {
      if (!line) {
        line = word;
      } else if (line.length + 1 + word.length <= maxWidth) {
        line += " " + word;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}
