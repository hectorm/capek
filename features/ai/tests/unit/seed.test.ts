import { describe, expect, it } from "vitest";

import { aiSeed } from "#layers/ai/server/seed";

describe("agent seed", () => {
  it("rejects tool switches on triage agents and allows named resources", () => {
    const agent = { name: "router", type: "triage", model: "m", llmProvider: "provider" };
    for (const settings of [{ tools: { ai_tables: true } }, { codeInterpreter: true }]) {
      expect(() => aiSeed.schema.agents.parse([{ ...agent, ...settings }])).toThrow("Only specialist agents");
    }
    expect(aiSeed.schema.agents.parse([{ ...agent, tools: { datasources: ["sales"] } }])).toHaveLength(1);
  });
});
