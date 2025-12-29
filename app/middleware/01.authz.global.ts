import { abortNavigation, defineNuxtRouteMiddleware, navigateTo } from "nuxt/app";

import type { PermissionName } from "~~/shared/rbac";
import { usePermissions } from "~/composables/permissions";

declare module "#app" {
  interface PageMeta {
    permissions?: PermissionName[];
    permissionsStrict?: boolean;
  }
}

export default defineNuxtRouteMiddleware(async (to) => {
  const { can, canAny } = usePermissions();

  if (to.meta.permissions && !(to.meta.permissionsStrict ? can : canAny)(to.meta.permissions)) {
    if (to.path !== "/") {
      return navigateTo({ path: "/" }, { redirectCode: 302 });
    } else {
      return abortNavigation();
    }
  }
});
