import type { AsyncComponentLoader, Component } from "vue";

import type { PermissionName } from "#layers/core/shared/rbac";

export interface AppMenuItem {
  // i18n key of the item label
  label: string;
  icon: string;
  to: string;
  // Only match the exact route when highlighting the active item
  exact?: boolean;
  // Show the item only to users holding any of these permissions
  permissions?: PermissionName[];
  // Tabs of the section, the item links to the first one the user can access and is hidden if there is none
  tabs?: readonly AppMenuItem[] | ((features: readonly AppFeature[]) => readonly AppMenuItem[]);
  // Position of the item, lower values come first
  order?: number;
}

export interface AppSidebarSection {
  // Loader of the sidebar component, which receives a `collapsed` boolean prop
  component: AsyncComponentLoader<Component>;
  // Show the section only to users holding any of these permissions
  permissions?: PermissionName[];
  // Position of the section, lower values come first
  order?: number;
}

// Client side contribution of a layer (its `app/feature.ts`), extensible through declaration merging
export interface AppFeature {
  name: string;
  // Runs in the default layout setup for every user, so it must check the permissions it requires
  setup?: () => void;
  // Page that "/" redirects to, the one with the lowest order the user can access wins
  home?: { to: string; permissions?: PermissionName[]; order?: number };
  // Entries of the main navigation, shown at the top of the sidebar
  navigation?: AppMenuItem[];
  // Sections of the sidebar, shown below the main navigation
  sidebar?: AppSidebarSection[];
  userMenu?: AppMenuItem[];
  settingsTabs?: AppMenuItem[];
  studioTabs?: AppMenuItem[];
}

export const defineAppFeature = (feature: AppFeature): AppFeature => feature;

// Key of a message of a feature, whose messages are under its name unless it is core
export const featureMessageKey = (feature: string, key: string): string =>
  feature === "core" ? key : `${feature}.${key}`;
