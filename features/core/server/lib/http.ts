import { STATUS_CODES } from "node:http";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { HttpHeaders } from "#layers/core/shared/http";
import { HttpRedactedValue } from "#layers/core/shared/http";

export interface Endpoint {
  url: string;
  apiKey?: string;
  headers: HttpHeaders;
}

const ERROR_TEXT_MAX_CHARS = 1000;
const ERROR_BODY_MAX_BYTES = 16_384;

const ErrorMessageSchema = z.string().trim().min(1);
const ApiErrorSchema = z.union([
  z.object({ error: z.object({ message: ErrorMessageSchema }) }).transform((body) => body.error.message),
  z.object({ error: ErrorMessageSchema }).transform((body) => body.error),
  z.object({ message: ErrorMessageSchema }).transform((body) => body.message),
  z.object({ detail: ErrorMessageSchema }).transform((body) => body.detail),
]);

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

// Reads the first bytes of a body as text
export const readBodyStart = async (body: AsyncIterable<Uint8Array> | null, maxBytes: number): Promise<string> => {
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for await (const chunk of body ?? []) {
    text += decoder.decode(chunk.subarray(0, maxBytes - bytes), { stream: true });
    bytes += chunk.byteLength;
    if (bytes >= maxBytes) {
      break;
    }
  }
  return text + decoder.decode();
};

// Describes a failed response without exposing bodies other than API errors
export const readErrorMessage = async (response: Response): Promise<string> => {
  const body = await readBodyStart(response.body, ERROR_BODY_MAX_BYTES);

  let message: string | undefined;
  try {
    message = ApiErrorSchema.safeParse(JSON.parse(body)).data;
  } catch {
    // The body is not JSON
  }

  const status = `${String(response.status)} ${STATUS_CODES[response.status] ?? ""}`.trim();
  if (!message) {
    return status;
  }
  return message.length > ERROR_TEXT_MAX_CHARS
    ? `${status}: ${message.slice(0, ERROR_TEXT_MAX_CHARS).toWellFormed()}...`
    : `${status}: ${message}`;
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
