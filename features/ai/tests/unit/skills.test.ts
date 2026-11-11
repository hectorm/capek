import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "#layers/core/shared/schema";
import { parseSkillParameters } from "#layers/ai/server/lib/skills/validator";
import { closeDb, createAiTestDb } from "#layers/ai/tests/unit/helpers/db";

let db: Kysely<Database>;

beforeAll(async () => {
  db = await createAiTestDb();
});

afterAll(async () => {
  await closeDb();
});

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

  it("keeps the names of the parameters of a stored skill", async () => {
    const parameters = { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] };
    await db
      .insertInto("aiSkills")
      .values({
        name: "reader",
        description: "",
        documentation: null,
        code: null,
        parameters: JSON.stringify(parameters),
      })
      .execute();

    const skill = await db
      .selectFrom("aiSkills")
      .select(["parameters"])
      .where("name", "=", "reader")
      .executeTakeFirstOrThrow();
    expect(skill.parameters).toEqual(parameters);
  });
});
