import { describe, expect, it } from "vitest";

import { parseSkillParameters } from "#layers/ai/server/lib/skills/validator";

describe("skills", () => {
  it("requires only the parameters that are not marked as optional", () => {
    const code = [
      "/**",
      " * Greets someone.",
      " * @param {Object} params",
      " * @param {string} params.name - Who to greet",
      " * @param {number} [params.times] - How many times",
      " * @param {Object} params.options",
      " * @param {boolean} [params.options.loud] - Whether to shout",
      " */",
      "export default async function (params) {}",
    ].join("\n");

    const parameters = parseSkillParameters(code)?.parameters;
    expect(Object.keys(parameters?.properties ?? {})).toEqual(["name", "times", "options"]);
    expect(parameters?.required).toEqual(["name", "options"]);
    expect(parameters?.properties?.name).toEqual({ type: "string", description: "Who to greet" });
    expect(parameters?.properties?.options).not.toHaveProperty("required");
  });
});
