import { useNuxtApp } from "nuxt/app";

import type { Principal } from "~~/shared/rbac";

export const usePrincipalSearch = () => {
  const { $trpc } = useNuxtApp();
  const cache = new Map<string, { label: string; icon: string }>();

  const search = async (query?: string): Promise<string[]> => {
    const [groups, users] = await Promise.all([
      $trpc.group.search.query({ search: query, limit: 25 }),
      $trpc.user.search.query({ search: query, limit: 25 }),
    ]);

    groups.groups.forEach((g) => {
      cache.set(`group:${g.id}`, { label: g.name, icon: "i-lucide-users" });
    });
    users.users.forEach((u) => {
      cache.set(`user:${u.id}`, { label: `${u.username} (${u.email})`, icon: "i-lucide-user" });
    });

    return [...groups.groups.map((g) => `group:${g.id}`), ...users.users.map((u) => `user:${u.id}`)];
  };

  const getLabel = (id: string): string => {
    return cache.get(id)?.label ?? id;
  };

  const getIcon = (id: string): string | undefined => {
    return cache.get(id)?.icon;
  };

  const preload = (accessList: Principal[]) => {
    accessList.forEach((item) => {
      if (item.type === "group") {
        cache.set(`group:${item.id}`, { label: item.groupname, icon: "i-lucide-users" });
      } else {
        cache.set(`user:${item.id}`, { label: `${item.username} (${item.email})`, icon: "i-lucide-user" });
      }
    });
  };

  return {
    search,
    getLabel,
    getIcon,
    preload,
  };
};
