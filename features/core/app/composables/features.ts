import type { Component, ComputedRef } from "vue";
import { computed, defineAsyncComponent } from "vue";

import features from "#features/app";

import type { AppFeature, AppMenuItem } from "#layers/core/app/utils/features";
import { usePermissions } from "#layers/core/app/composables/permissions";

// Client side features of all layers, each one after the features it depends on
export const getAppFeatures = (): readonly AppFeature[] => features;

const byOrder = (a: { order?: number }, b: { order?: number }): number => (a.order ?? 0) - (b.order ?? 0);

const sidebarSections = features
  .flatMap((feature) => feature.sidebar ?? [])
  .toSorted(byOrder)
  .map((section) => ({ permissions: section.permissions, component: defineAsyncComponent(section.component) }));

const layoutSetups = features.flatMap((feature) => (feature.setup ? [feature.setup] : []));

export const useAppFeatures = () => {
  const { canAny } = usePermissions();

  const isAllowed = (item: { permissions?: AppMenuItem["permissions"] }): boolean => {
    return !item.permissions || canAny(item.permissions);
  };

  // Keeps the items the user can access, linking the items with tabs to the first accessible one
  const resolveItems = (items: readonly AppMenuItem[]): AppMenuItem[] => {
    return items
      .filter(isAllowed)
      .toSorted(byOrder)
      .flatMap((item) => {
        if (!item.tabs) {
          return [item];
        }
        const [tab] = resolveItems(typeof item.tabs === "function" ? item.tabs(features) : item.tabs);
        return tab ? [{ ...item, to: tab.to }] : [];
      });
  };

  const menu = (pick: (feature: AppFeature) => AppMenuItem[] | undefined): ComputedRef<AppMenuItem[]> => {
    return computed(() => resolveItems(features.flatMap((feature) => pick(feature) ?? [])));
  };

  return {
    resolveItems,
    home: computed(() => {
      return features
        .flatMap((feature) => (feature.home && isAllowed(feature.home) ? [feature.home] : []))
        .toSorted(byOrder)[0]?.to;
    }),
    navigation: menu((feature) => feature.navigation),
    layoutSetups,
    sidebarSections: computed<{ component: Component }[]>(() => sidebarSections.filter(isAllowed)),
    userMenu: menu((feature) => feature.userMenu),
    settingsTabs: menu((feature) => feature.settingsTabs),
    studioTabs: menu((feature) => feature.studioTabs),
  };
};
