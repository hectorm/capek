import type { Kysely } from "kysely";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { FeatureToolProvider, ResourceToolProvider, Tool, Toolset } from "#layers/core/server/lib/tools/define";
import type { Database } from "#layers/core/shared/schema";
import { usableResourceIds } from "#layers/core/server/lib/authz/resources";
import { withUserTransaction } from "#layers/core/server/lib/database";
import { syncLinks } from "#layers/core/server/lib/database/links";
import { assertFeaturePrefix } from "#layers/core/server/lib/features/define";
import { hasToolResources } from "#layers/core/server/lib/tools/define";

export interface AgentToolset extends Toolset {
  provider: string;
}

// Tools of an agent, with only the assigned resources that the calling user can use and that still exist
export const loadAgentToolsets = async (
  db: Kysely<Database>,
  providers: readonly FeatureToolProvider[],
  agentId: string,
  user: AuthUser,
): Promise<AgentToolset[]> => {
  const assigned = await db
    .selectFrom("aiAgentToolResources")
    .select(["resourceType", "resourceId"])
    .where("agentId", "=", agentId)
    .execute();
  const agent = await db.selectFrom("aiAgents").select(["toolProviders"]).where("id", "=", agentId).executeTakeFirst();

  return withUserTransaction(user, async (trx) => {
    const toolsets: AgentToolset[] = [];
    const toolNames = new Set<string>();
    for (const provider of providers) {
      const resourceIds = hasToolResources(provider)
        ? await usableResourceIds(
            trx,
            provider.resource,
            assigned
              .filter((resource) => resource.resourceType === provider.resource.type)
              .map((resource) => resource.resourceId),
          )
        : [];
      const enabled = hasToolResources(provider)
        ? resourceIds.length > 0
        : (agent?.toolProviders.includes(provider.name) ?? false);
      if (!enabled) {
        continue;
      }

      const toolset = await provider.load(trx, resourceIds);
      for (const tool of toolset.tools) {
        assertFeaturePrefix(provider.feature, tool.name, "Tool");
        if (toolNames.has(tool.name)) {
          throw new Error(`Duplicate tool "${tool.name}" in tool provider "${provider.name}"`);
        }
        toolNames.add(tool.name);
      }
      toolsets.push({ ...toolset, provider: provider.name });
    }
    return toolsets;
  });
};

// Text without the characters that the database rejects
export const sanitize = (text: string): string => text.toWellFormed().replaceAll("\0", "\uFFFD");

// Cuts the output of a tool that is too long for the model
export const truncate = (text: string, maxChars: number): string => {
  const output = sanitize(text);
  if (output.length <= maxChars) {
    return output;
  }
  return `${output.slice(0, maxChars).toWellFormed()}\n\n[Response truncated: ${String(output.length)} characters, showing first ${String(maxChars)}]`;
};

export const findAgentTool = (
  toolsets: readonly AgentToolset[],
  name: string,
): { provider: string; tool: Tool } | undefined => {
  for (const toolset of toolsets) {
    const tool = toolset.tools.find((candidate) => candidate.name === name);
    if (tool) {
      return { provider: toolset.provider, tool };
    }
  }
  return undefined;
};

// Replaces the resources of a tool provider assigned to an agent with the given ones
export const syncAgentToolResources = (
  db: Kysely<Database>,
  agentId: string,
  provider: ResourceToolProvider,
  resourceIds: readonly string[],
): Promise<{ added: number; removed: number }> => {
  return syncLinks(
    db,
    "ai_agent_tool_resources",
    { agent_id: agentId, resource_type: provider.resource.type },
    "resource_id",
    resourceIds,
  );
};
