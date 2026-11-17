import { parse } from "comment-parser";

import type { OpenAIFunctionParameters } from "#layers/ai/shared/openai";
import { getQuickJSModule } from "#layers/ai/server/lib/code/interpreter";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

const VALIDATION_MAX_MEMORY_BYTES = 8 * 1024 * 1024;
const VALIDATION_TIMEOUT_MS = 5_000;

const TYPE_MAP: Record<string, string> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  object: "object",
};

export type ValidationResult = { valid: true } | { valid: false; error: string };

interface ParsedParameter {
  path: string[];
  type: string;
  description: string;
  required: boolean;
}

interface SkillParseResult {
  description: string;
  parameters: OpenAIFunctionParameters;
}

export const parseSkillParameters = (code: string): SkillParseResult | null => {
  const parsed = parse(code);

  const firstBlock = parsed.at(0);
  if (firstBlock === undefined) {
    return null;
  }

  const description = firstBlock.description.trim();

  const paramTags = firstBlock.tags.filter((tag) => tag.tag === "param");

  const relevantParams = paramTags
    .filter((tag) => !(/^params$/i.test(tag.name) && /^object$/i.test(tag.type)))
    .map(parseParameter)
    .filter((p): p is ParsedParameter => p !== null);

  const parameters = buildNestedSchema(relevantParams);

  return {
    description,
    parameters,
  };
};

export const validateSkillJSDoc = (code: string): ValidationResult => {
  const result = parseSkillParameters(code);

  if (!result) {
    return {
      valid: false,
      error: "No JSDoc block found. Skills require a JSDoc comment with a description.",
    };
  }

  if (result.description === "") {
    return {
      valid: false,
      error: "JSDoc block must include a description for the skill.",
    };
  }

  return { valid: true };
};

export const validateSkillSyntax = async (code: string): Promise<ValidationResult> => {
  try {
    const quickJS = await getQuickJSModule();
    const runtime = quickJS.newRuntime();

    runtime.setMemoryLimit(VALIDATION_MAX_MEMORY_BYTES);
    const deadline = Date.now() + VALIDATION_TIMEOUT_MS;
    runtime.setInterruptHandler(() => Date.now() > deadline);
    runtime.setModuleLoader(() => "");

    const context = runtime.newContext();

    try {
      const result = context.evalCode(code, "skill.js", { type: "module", compileOnly: true });
      if (result.error) {
        const error: unknown = context.dump(result.error);
        result.error.dispose();
        logger.warn({ error }, "Skill syntax validation failed");
        return { valid: false, error: "Invalid syntax" };
      }

      result.value.dispose();
      return { valid: true };
    } finally {
      context.dispose();
      runtime.dispose();
    }
  } catch (error) {
    logger.error({ error }, "Skill syntax validation error");
    return { valid: false, error: "Syntax validation failed" };
  }
};

const parseJSDocType = (typeStr: string): { type: string; items?: { type: string }; enum?: string[] } => {
  const normalized = typeStr.trim().toLowerCase();

  const bracketArrayMatch = /^(\w+)\[\]$/.exec(normalized);
  if (bracketArrayMatch?.[1]) {
    const itemType = TYPE_MAP[bracketArrayMatch[1]] ?? "string";
    return { type: "array", items: { type: itemType } };
  }

  const genericArrayMatch = /^array<(\w+)>$/.exec(normalized);
  if (genericArrayMatch?.[1]) {
    const itemType = TYPE_MAP[genericArrayMatch[1]] ?? "string";
    return { type: "array", items: { type: itemType } };
  }

  if (typeStr.includes("|") && !typeStr.includes("{")) {
    const parts = typeStr.split("|").map((v) => v.trim().replace(/^["']|["']$/g, ""));
    if (parts.every((p) => p && !p.includes(" "))) {
      return { type: "string", enum: parts };
    }
  }

  return { type: TYPE_MAP[normalized] ?? "object" };
};

const parseParameter = (tag: {
  name: string;
  type: string;
  description: string;
  optional: boolean;
}): ParsedParameter | null => {
  const { name, type, description, optional } = tag;

  const match = /^\[?params\.(.+?)\]?$/.exec(name) ?? /^\[?params\.(.+)\]$/.exec(name);
  if (!match?.[1]) {
    return null;
  }

  const paramPath = match[1].replace(/\]$/, "");
  const pathParts = paramPath.split(".");

  return {
    path: pathParts,
    type: type || "string",
    description: description.replace(/^-\s*/, ""),
    required: !optional,
  };
};

const buildNestedSchema = (params: ParsedParameter[]): OpenAIFunctionParameters => {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  const topLevelParams = new Map<string, ParsedParameter[]>();

  for (const param of params) {
    const rootKey = param.path[0];
    if (!rootKey) {
      continue;
    }

    let paramsArray = topLevelParams.get(rootKey);
    if (!paramsArray) {
      paramsArray = [];
      topLevelParams.set(rootKey, paramsArray);
    }
    paramsArray.push(param);
  }

  for (const [rootKey, relatedParams] of topLevelParams) {
    const singleLevelParams = relatedParams.filter((p) => p.path.length === 1);
    const nestedParams = relatedParams.filter((p) => p.path.length > 1);

    if (nestedParams.length > 0) {
      const nestedSchema = buildNestedSchema(
        nestedParams.map((p) => ({
          ...p,
          path: p.path.slice(1),
        })),
      );

      properties[rootKey] = {
        type: "object",
        properties: nestedSchema.properties,
        ...(nestedSchema.required && nestedSchema.required.length > 0 ? { required: nestedSchema.required } : {}),
      };

      if (relatedParams.some((p) => p.required && p.path.length === 1)) {
        required.push(rootKey);
      }
    } else {
      const param = singleLevelParams.at(0);
      if (param !== undefined) {
        const parsedType = parseJSDocType(param.type);

        properties[rootKey] = {
          ...parsedType,
          ...(param.description ? { description: param.description } : {}),
        };

        if (param.required) {
          required.push(rootKey);
        }
      }
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
};
