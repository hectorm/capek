import { useChatData } from "#layers/ai/app/composables/chat-data";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { defineAppFeature } from "#layers/core/app/utils/features";

export default defineAppFeature({
  name: "ai",
  setup: useChatData,
  home: { to: "/ai" },
  sidebar: [
    {
      component: () => import("#layers/ai/app/components/chat/SessionsSidebar.vue"),
      permissions: [AiPermissions.ChatListAll, AiPermissions.ChatListOwn],
    },
  ],
  studioTabs: [
    {
      label: "ai.pages.studio.agents.tab",
      icon: "i-lucide-bot",
      to: "/studio/ai/agents",
      permissions: [AiPermissions.AgentCreate, AiPermissions.AgentUpdateAll, AiPermissions.AgentUpdateOwn],
      order: 0,
    },
    {
      label: "ai.pages.studio.llmProviders.tab",
      icon: "i-lucide-brain",
      to: "/studio/ai/llm-providers",
      permissions: [
        AiPermissions.LlmProviderCreate,
        AiPermissions.LlmProviderUpdateAll,
        AiPermissions.LlmProviderUpdateOwn,
      ],
      order: 10,
    },
    {
      label: "ai.pages.studio.mcpServers.tab",
      icon: "i-lucide-wrench",
      to: "/studio/ai/mcp-servers",
      permissions: [AiPermissions.McpServerCreate, AiPermissions.McpServerUpdateAll, AiPermissions.McpServerUpdateOwn],
      order: 20,
    },
    {
      label: "ai.pages.studio.skills.tab",
      icon: "i-lucide-code",
      to: "/studio/ai/skills",
      permissions: [AiPermissions.SkillCreate, AiPermissions.SkillUpdateAll, AiPermissions.SkillUpdateOwn],
      order: 30,
    },
  ],
});
