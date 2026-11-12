import { TRPCError } from "@trpc/server";

import type { HttpHeaders } from "#layers/core/shared/http";
import { HttpRedactedValue } from "#layers/core/shared/http";

export interface Endpoint {
  url: string;
  apiKey?: string;
  headers: HttpHeaders;
}

const ERROR_TEXT_MAX_CHARS = 1000;

// Requests an endpoint without following redirects
export const fetchEndpoint = async (url: string | URL, init: RequestInit = {}): Promise<Response> => {
  const response = await fetch(url, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    const location = response.headers.get("Location")?.slice(0, ERROR_TEXT_MAX_CHARS);
    throw new Error(`The endpoint redirects${location ? ` to "${location}"` : ""}, its URL has to be changed`);
  }
  return response;
};

// Start of the body of a failed response
export const readErrorText = async (response: Response): Promise<string> => {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length <= ERROR_TEXT_MAX_CHARS) {
      const { done, value } = await reader.read();
      if (done) {
        return text;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return `${text.slice(0, ERROR_TEXT_MAX_CHARS).toWellFormed()}…`;
};

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
