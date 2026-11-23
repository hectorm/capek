import { describe, expect, it } from "vitest";

import { parseSkillParameters, validateSkillSyntax } from "#layers/ai/server/lib/skills/validator";
import { longestStall } from "#layers/ai/tests/unit/helpers/event-loop";

describe("skill parameter", () => {
  it("is required unless marked as optional", () => {
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

describe("skill syntax", () => {
  it("checks the syntax of a skill without running it", async () => {
    const stall = await longestStall(async () => {
      expect(await validateSkillSyntax(`while (true) {}\nexport default async function () {}`)).toEqual({
        valid: true,
      });
    });
    expect(stall).toBeLessThan(250);
    expect(await validateSkillSyntax(`export default async function ( {`)).toMatchObject({ valid: false });
  });

  it("checks the syntax of the imports of a skill without loading them", async () => {
    const code = (line: string): string => `${line}\nexport default async function () {}`;
    expect(await validateSkillSyntax(code("import { $read } from '/tools/index.js';"))).toEqual({ valid: true });
    expect(await validateSkillSyntax(code("import read from './missing.js';"))).toEqual({ valid: true });
    expect(await validateSkillSyntax(code("import foo bar from './missing.js';"))).toMatchObject({ valid: false });
  });
});
