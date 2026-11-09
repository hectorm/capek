import features from "#features/server";

import type { ServerFeature } from "#layers/core/server/lib/features/define";

// Server side features of all layers, each one after the features it depends on
export const getServerFeatures = (): readonly ServerFeature[] => features;
