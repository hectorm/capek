import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AgentToolset } from "#layers/ai/server/lib/tools";
import type { ServerFeature } from "#layers/core/server/lib/features/define";
import type { ToolContext } from "#layers/core/server/lib/tools/define";
import type { Database } from "#layers/core/shared/schema";
import aiFeature from "#layers/ai/server/feature";
import { buildCodeInterpreterPrompt, buildToolsetsPrompt } from "#layers/ai/server/lib/agents/prompts";
import { createVFS } from "#layers/ai/server/lib/code/generators";
import { executeCode } from "#layers/ai/server/lib/code/interpreter";
import { SkillResource } from "#layers/ai/server/lib/resources";
import { loadAgentToolsets, syncAgentToolResources } from "#layers/ai/server/lib/tools";
import { asUser, closeDb, createAiTestDb, insertAgent, insertSkill } from "#layers/ai/tests/unit/helpers/db";
import coreFeature from "#layers/core/server/feature";
import { listResources } from "#layers/core/server/lib/authz/resources";
import { collectToolProviders, defineToolProvider } from "#layers/core/server/lib/tools/define";

let db: Kysely<Database>;

const alice = crypto.randomUUID();

let agentId: string;
let usableSkillId: string;
let otherSkillId: string;

// Skills stand in for the resources of another feature
const notesProvider = defineToolProvider({
  name: "notes",
  label: "notes.tools.label",
  resource: SkillResource,
  async load(toolsDb, resourceIds) {
    const resources = await listResources(toolsDb, SkillResource, { ids: resourceIds });
    return {
      tools: [
        {
          name: "notes_read",
          description: "Read a note",
          parameters: {
            type: "object",
            properties: { note: { type: "string", enum: resources.map((resource) => resource.name) } },
            required: ["note"],
          },
          execute: (args) => {
            if (!resources.some((resource) => resource.name === args.note)) {
              return Promise.reject(new Error(`Note "${String(args.note)}" not found`));
            }
            return Promise.resolve(JSON.stringify({ note: args.note, content: "hello" }));
          },
        },
      ],
      instructions: "## Notes\n\nUse `notes_read` to read a note.",
      documents: Object.fromEntries(resources.map((resource) => [`${resource.name}.md`, `About ${resource.name}`])),
    };
  },
});
// Provider without resources, switched on for each agent
const profileProvider = defineToolProvider({
  name: "notes_profile",
  label: "notes.tools.profile.label",
  load: (_db, resourceIds) =>
    Promise.resolve({
      tools: [
        {
          name: "notes_whoami",
          description: "Identify the user",
          parameters: { type: "object", properties: {} },
          execute: (_args, { user }) => Promise.resolve(JSON.stringify({ userId: user.id, resources: resourceIds })),
        },
      ],
    }),
});
const notesFeature: ServerFeature = { name: "notes", tools: [notesProvider, profileProvider] };
const providers = collectToolProviders([coreFeature, aiFeature, notesFeature]);

const agentEditor = ["ai_agent:update:own", "ai_agent:read:own"];
const skillUser = ["ai_skill:read:own", "ai_skill:use:own"];

beforeAll(async () => {
  db = await createAiTestDb();

  await db
    .insertInto("users")
    .values([{ id: alice, username: "alice", fullname: "Alice", email: "alice@example.com" }])
    .execute();

  agentId = await insertAgent(db, "tools-agent");
  usableSkillId = await insertSkill(db, "usable-note");
  otherSkillId = await insertSkill(db, "other-note");

  await db.insertInto("aiAgentAccess").values({ agentId, userId: alice, role: "editor" }).execute();
  await db.insertInto("aiSkillAccess").values({ skillId: usableSkillId, userId: alice, role: "user" }).execute();
});

afterAll(async () => {
  await closeDb();
});

describe("agent tool resources", () => {
  it("requires use access to the resources assigned to an agent", async () => {
    const permissions = [...agentEditor, ...skillUser];

    await expect(
      asUser({ id: alice, permissions }, (trx) => syncAgentToolResources(trx, agentId, notesProvider, [otherSkillId])),
    ).rejects.toThrow(/row-level security/);

    // Editing the agent is not enough without the permission to use the resources
    await expect(
      asUser({ id: alice, permissions: agentEditor }, (trx) =>
        syncAgentToolResources(trx, agentId, notesProvider, [usableSkillId]),
      ),
    ).rejects.toThrow(/row-level security/);

    const result = await asUser({ id: alice, permissions }, (trx) =>
      syncAgentToolResources(trx, agentId, notesProvider, [usableSkillId]),
    );
    expect(result).toEqual({ added: 1, removed: 0 });
  });

  it("lists the resources that a user can assign", async () => {
    const names = await asUser({ id: alice, permissions: skillUser }, async (trx) => {
      const resources = await listResources(trx, SkillResource, { search: "note", limit: 10 });
      return resources.map((resource) => resource.name);
    });
    expect(names).toEqual(["usable-note"]);
  });

  it("loads the tools of the assigned resources, ignoring the ones that are gone", async () => {
    await db
      .insertInto("aiAgentToolResources")
      .values([
        { agentId, resourceType: SkillResource.type, resourceId: crypto.randomUUID() },
        { agentId, resourceType: "removed_feature_resource", resourceId: crypto.randomUUID() },
      ])
      .execute();

    const toolsets = await loadAgentToolsets(db, providers, agentId);
    expect(toolsets.map((toolset) => toolset.provider)).toEqual(["notes"]);
    expect(toolsets[0]?.tools.map((tool) => tool.name)).toEqual(["notes_read"]);
    expect(toolsets[0]?.tools[0]?.parameters.properties.note).toEqual({ type: "string", enum: ["usable-note"] });

    expect(buildToolsetsPrompt(toolsets)).toBe(
      "## Notes\n\nUse `notes_read` to read a note.\n\n### usable-note\n\nAbout usable-note",
    );
  });

  it("loads the tools of the providers switched on for the agent", async () => {
    expect(providers.map((provider) => [provider.name, provider.resource?.type])).toEqual([
      ["notes", "ai_skill"],
      ["notes_profile", undefined],
    ]);

    const loadedTools = async (): Promise<string[]> => {
      const loaded = await loadAgentToolsets(db, providers, agentId);
      return loaded.flatMap((candidate) => candidate.tools.map((tool) => tool.name));
    };
    expect(await loadedTools()).toEqual(["notes_read"]);

    // Providers of features that are not part of the build are ignored
    await db
      .updateTable("aiAgents")
      .set({ toolProviders: ["notes_profile", "removed_feature"] })
      .where("id", "=", agentId)
      .execute();
    expect(await loadedTools()).toEqual(["notes_read", "notes_whoami"]);

    // Their tools act on behalf of the user that calls them
    const [, toolset] = await loadAgentToolsets(db, providers, agentId);
    const result = await toolset?.tools[0]?.execute({}, { user: { id: alice } } as ToolContext);
    expect(result).toBe(JSON.stringify({ userId: alice, resources: [] }));

    await db.updateTable("aiAgents").set({ toolProviders: [] }).where("id", "=", agentId).execute();
    expect(await loadedTools()).toEqual(["notes_read"]);
  });

  it("rejects tools that do not start with the name of their feature", async () => {
    const provider = defineToolProvider({
      ...notesProvider,
      load: () =>
        Promise.resolve({
          tools: [
            {
              name: "read",
              description: "",
              parameters: { type: "object", properties: {} },
              execute: () => Promise.resolve(""),
            },
          ],
        }),
    });
    await expect(loadAgentToolsets(db, [{ ...provider, feature: "notes" }], agentId)).rejects.toThrow(
      /Tool "read" of feature "notes" must start with "notes_"/,
    );
  });

  it("exposes the tools in the code interpreter", async () => {
    const toolsets: AgentToolset[] = await loadAgentToolsets(db, providers, agentId);
    const vfs = createVFS([], [], toolsets);

    expect(vfs.readFile("/tools/notes/README.md")).toContain("notes_read");
    expect(vfs.readFile("/tools/notes/docs/usable-note.md")).toBe("About usable-note");
    expect(buildCodeInterpreterPrompt({ toolProviders: ["notes"] })).toContain("# Tools of one kind: notes");
    expect(buildCodeInterpreterPrompt()).not.toContain("/tools/");

    const context = { user: { id: alice } } as ToolContext;
    const options = {
      chatSessionId: crypto.randomUUID(),
      vfs,
      mcpServers: [],
      tools: { toolsets, context },
      maxExecutionMs: 10_000,
      maxMemoryBytes: 25 * 1024 * 1024,
    };

    const found = await executeCode(
      `const { $notes_read } = await import("/tools/index.js"); return await $notes_read({ note: "usable-note" });`,
      options,
    );
    expect(found.error).toBeNull();
    expect(found.result).toEqual({ note: "usable-note", content: "hello" });
    expect(found.toolCallLogs).toMatchObject([{ provider: "notes", toolName: "notes_read", error: null }]);

    const missing = await executeCode(
      `const { $notes_read } = await import("/tools/notes/index.js"); return await $notes_read({ note: "other-note" });`,
      options,
    );
    expect(missing.error).toContain(`Note "other-note" not found`);
    expect(missing.toolCallLogs).toMatchObject([{ toolName: "notes_read", result: null }]);
  });
});
