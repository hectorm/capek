import features from "#features/server";

import type { ServerFeature } from "#layers/core/server/lib/features/define";

// Server features load in dependency order
export const getServerFeatures = (): readonly ServerFeature[] => features;
