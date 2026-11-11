import { TRPCError } from "@trpc/server";

import type { HttpHeaders } from "#layers/core/shared/http";
import { HttpRedactedValue } from "#layers/core/shared/http";

export interface Endpoint {
  url: string;
  apiKey?: string;
  headers: HttpHeaders;
}

// Completes what a client sends of an endpoint with the stored one, whose secrets are only taken for the same URL
export const unredactEndpoint = (incoming: Partial<Endpoint>, stored: Endpoint | undefined): Required<Endpoint> => {
  // Stored secrets that the endpoint keeps
  let kept = 0;
  const unredact = (value: string | undefined, storedValue: string | undefined): string => {
    if (value !== undefined && value !== HttpRedactedValue) {
      return value;
    }
    kept += storedValue ? 1 : 0;
    return storedValue ?? "";
  };

  const url = incoming.url ?? stored?.url ?? "";
  const apiKey = unredact(incoming.apiKey, stored?.apiKey);
  // Headers that were not sent are the stored ones, all left hidden
  const hidden = stored?.headers.map((h) => ({ ...h, value: HttpRedactedValue })) ?? [];
  const headers = (incoming.headers ?? hidden).map((h) => {
    return { ...h, value: unredact(h.value, stored?.headers.find((s) => s.name === h.name)?.value) };
  });

  if (kept > 0 && url !== stored?.url) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The hidden secrets have to be entered again to change the URL",
    });
  }

  return { url, apiKey, headers };
};
