# AI

This feature adds a chat where users ask questions and AI agents answer them. Agents are set up in the Studio, where their builders choose the model each one uses, the tools it can call and who can talk to it.

## Agents

Each agent answers through an LLM provider, which can be any OpenAI-compatible API, and can call the tools of its MCP servers and skills. Specialist agents answer directly, while triage agents route each request to one of their specialists.

Agents, LLM providers, MCP servers and skills are shared with users and groups, either as editors, who can update, delete and share them, or as users, who can use them. Assigning a provider, MCP server, skill or specialist to an agent requires permission to edit the agent and to use the resource. Once assigned, everyone who can use the agent uses them through it, without having access to them directly.

## Configuration

`NUXT_AI_QUICK_CHATS` sets the default prompts of the welcome page, separated by `;`, which can be changed in the Settings. The `ai` section of the seed configuration creates LLM providers, MCP servers, skills and agents (see `compose.base.yaml`).

## Code interpreter

The code interpreter runs JavaScript code in a [QuickJS](https://bellard.org/quickjs/) WASM build with memory and execution time constraints.

Each chat session has its own in-memory Virtual File System (VFS). The `/workspace` directory is writable; other paths are read-only. A Node.js-like `fs` API is available for file operations.

Skills and MCP tools are exposed as ES modules under `/skills/index.js` and `/servers/index.js`:

```js
const { $mySkill } = await import("/skills/index.js");
const { $myTool } = await import("/servers/myServer/index.js");
```

The agent is provided with usage context and can dynamically discover available tools and skills by exploring the VFS (e.g., reading `SKILL.md` files for documentation).
