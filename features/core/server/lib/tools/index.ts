import type { FeatureToolProvider } from "#layers/core/server/lib/tools/define";
import { getServerFeatures } from "#layers/core/server/lib/features";
import { collectToolProviders } from "#layers/core/server/lib/tools/define";

let toolProviders: readonly FeatureToolProvider[] | null = null;

export const getToolProviders = (): readonly FeatureToolProvider[] =>
  (toolProviders ??= collectToolProviders(getServerFeatures()));
