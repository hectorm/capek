import type { AsyncComponentLoader, Component } from "vue";

import type { PermissionName } from "#layers/core/shared/rbac";

export interface AppMenuItem {
  // i18n key of the item label
  label: string;
  icon: string;
  to: string;
  // Only the exact route marks this item active
  exact?: boolean;
  // Custom path match for the active item
  match?: (path: string) => boolean;
  // Any listed permission makes the item visible
  permissions?: PermissionName[];
  // The item links to its first accessible tab and stays hidden if none are accessible
  tabs?: readonly AppMenuItem[] | ((features: readonly AppFeature[]) => readonly AppMenuItem[]);
  // Lower values appear first
  order?: number;
}

export interface AppSidebarSection {
  // Sidebar components receive a boolean collapsed prop
  component: AsyncComponentLoader<Component>;
  // Any listed permission makes the section visible
  permissions?: PermissionName[];
  // Lower values appear first
  order?: number;
}

// Layers declare client features in app/feature.ts and extend this interface through declaration merging
export interface AppFeature {
  name: string;
  // Setup runs for every user and must check its own permissions
  setup?: () => void;
  // The root route redirects to the accessible home page with the lowest order
  home?: { to: string; permissions?: PermissionName[]; order?: number };
  // Page links appear together in the sidebar
  navigation?: AppMenuItem[];
  // Sections with an order below -1 appear before the page links
  sidebar?: AppSidebarSection[];
  userMenu?: AppMenuItem[];
  settingsTabs?: AppMenuItem[];
  studioTabs?: AppMenuItem[];
}

export const defineAppFeature = (feature: AppFeature): AppFeature => feature;

// Core uses unprefixed message keys. Other features use their name as the prefix
export const featureMessageKey = (feature: string, key: string): string => {
  return feature === "core" ? key : `${feature}.${key}`;
};
