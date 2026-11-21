# AI

This feature adds a chat where users ask questions and AI agents answer them. Agents are set up in the Studio, where
their builders choose the model each one uses, the tools it can call and who can talk to it.

Each agent answers through an LLM provider, which can be any API compatible with OpenAI Chat Completions,
[Open Responses](https://www.openresponses.org) or Anthropic Messages, and can call the tools of its MCP servers and
skills. Specialist agents answer directly, while triage agents route each request to one of their specialists. Agents
can also use the tools that other features provide, like the datasources assigned to them.

## Access

Agents, LLM providers, MCP servers and skills are shared with users and groups, either as editors, who can update,
delete and share them, or as users, who can use them. Assigning a provider, MCP server, skill or specialist to an agent
requires permission to edit the agent and to use the resource. Once assigned, everyone who can use the agent uses its
provider and specialists through it, while its MCP servers, skills and the resources of other features only reach the
users who can use them.

Administrators and creators create agents, LLM providers, MCP servers and skills. Members use the ones that are shared
with them, and auditors can read all of them. Chats stay private to their user for every role.

## Code interpreter

The code interpreter runs JavaScript code in a [QuickJS](https://bellard.org/quickjs/) WASM build with memory and
execution time constraints, in a worker thread that is terminated when the code ends or exceeds them.

The interpreter uses an in-memory virtual file system (VFS). The writable `/workspace` directory holds up to 10 MiB. In
chats, the application saves those files to the database for the session and loads them for later executions. Other
paths are read-only. A Node.js-like `fs` API is available for file operations.

Skills, MCP tools and the tools of other features are exposed as ES modules under `/skills/index.js`,
`/servers/index.js` and `/tools/index.js`.

```js
const { $mySkill } = await import("/skills/index.js");
const { $myTool } = await import("/servers/myServer/index.js");
const { $datasources_query } = await import("/tools/index.js");
```

The agent is provided with usage context and can discover the available tools and skills by exploring the VFS, for
example by reading the `SKILL.md` files.

## Configuration

`NUXT_AI_QUICK_CHATS` sets the default prompts of the welcome page, separated by `;`, which can be changed in the
Settings.

The `ai` section of the [seed configuration](../core/README.md#seed) creates LLM providers, MCP servers, skills and
agents, as `compose.base.yaml` shows. The `tools` field of an agent gives it the tools of other features, such as
`tools: { datasources: ["sales"] }`.

## Extending

Other features register tool providers with `defineToolProvider()` in the `tools` field of their server feature.
Datasources provides `datasources_query` through its adapter when AI is enabled. See
[Optional integrations](../README.md#optional-integrations).

Resource-backed providers expose the resources assigned to the agent that the caller can use. Providers without a
resource are enabled per agent. Both act on behalf of the caller. Provider and tool names use their feature's name.
