import type { User } from "#layers/core/shared/schema";
import { getServerFeatures } from "#layers/core/server/lib/features";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

export const runUserSyncHooks = async (user: User, claims: Readonly<Record<string, unknown>>): Promise<void> => {
  for (const feature of getServerFeatures()) {
    if (!feature.onUserSync) {
      continue;
    }
    try {
      await feature.onUserSync({ user, claims });
    } catch (error) {
      logger.warn({ error, userId: user.id, feature: feature.name }, "User sync hook failed");
    }
  }
};
