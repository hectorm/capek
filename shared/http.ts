import { z } from "zod/v4";

export const HttpHeaderSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(256)
    .trim()
    .regex(/^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/),
  value: z.string().min(1).max(8192).trim(),
});

export type HttpHeader = z.infer<typeof HttpHeaderSchema>;

export const HttpHeadersSchema = z.array(HttpHeaderSchema).max(50);

export type HttpHeaders = z.infer<typeof HttpHeadersSchema>;

export const HttpRedactedValue = "__REDACTED__" as const;

export const HttpRedactedHeaderSchema = z.object({
  ...HttpHeaderSchema.shape,
  value: z.literal(HttpRedactedValue),
});

export type HttpRedactedHeader = z.infer<typeof HttpRedactedHeaderSchema>;
