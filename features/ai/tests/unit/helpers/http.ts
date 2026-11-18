import type { EndpointInit } from "#layers/core/server/lib/http";

export const decodeRequestBody = (body: EndpointInit["body"]): string | undefined => {
  return body instanceof Uint8Array ? new TextDecoder().decode(body) : body;
};
