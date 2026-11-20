import { useCookie } from "nuxt/app";

export type CollectionLayout = "list" | "grid";

export const useCollectionLayout = (cookieName: string) => {
  return useCookie<CollectionLayout>(cookieName, {
    default: () => "list",
    maxAge: 365 * 24 * 60 * 60,
    sameSite: "lax",
  });
};
