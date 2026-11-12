# AI

This feature adds a chat where users ask questions and AI agents answer them. Agents are set up in the Studio, where their builders choose the model each one uses, the tools it can call and who can talk to it.

## Agents

Each agent answers through an LLM provider, which can be any API compatible with OpenAI Chat Completions, [Open Responses](https://www.openresponses.org) or Anthropic Messages, and can call the tools of its MCP servers and skills. Specialist agents answer directly, while triage agents route each request to one of their specialists.

Agents can also use the tools that other features provide, like the datasources assigned to them.

Agents, LLM providers, MCP servers and skills are shared with users and groups, either as editors, who can update, delete and share them, or as users, who can use them. Assigning a provider, MCP server, skill or specialist to an agent requires permission to edit the agent and to use the resource. Once assigned, everyone who can use the agent uses its provider and specialists through it, while its MCP servers, skills and the resources of other features only reach the users who can use them.

## Configuration

`NUXT_AI_QUICK_CHATS` sets the default prompts of the welcome page, separated by `;`, which can be changed in the Settings. The `ai` section of the seed configuration creates LLM providers, MCP servers, skills and agents (see `compose.base.yaml`). The `tools` field of an agent gives it the tools of other features (e.g. `tools: { datasources: ["sales"] }`).

## Code interpreter

The code interpreter runs JavaScript code in a [QuickJS](https://bellard.org/quickjs/) WASM build with memory and execution time constraints, in a worker thread that is terminated when the code ends or exceeds them.

Each chat session has its own in-memory Virtual File System (VFS). The `/workspace` directory is writable (up to 10 MB) and is kept between executions, other paths are read-only. A Node.js-like `fs` API is available for file operations.

Skills, MCP tools and the tools of other features are exposed as ES modules under `/skills/index.js`, `/servers/index.js` and `/tools/index.js`:

```js
const { $mySkill } = await import("/skills/index.js");
const { $myTool } = await import("/servers/myServer/index.js");
const { $datasources_query } = await import("/tools/index.js");
```

The agent is provided with usage context and can dynamically discover available tools and skills by exploring the VFS (e.g., reading `SKILL.md` files for documentation).
