import type { Logger } from "pino";
import { describe, expect, it } from "vitest";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import { RLSViolationError } from "#layers/core/server/lib/database/errors";
import { createCallerFactory, createTRPCRouter, protectedProcedure } from "#layers/core/server/trpc/init";

const router = createTRPCRouter({
  rejected: protectedProcedure.query(() => {
    throw new RLSViolationError('new row violates row-level security policy for table "secrets"');
  }),
  broken: protectedProcedure.query(() => {
    throw new Error('relation "secrets" does not exist');
  }),
});

const logger = { warn: () => undefined } as unknown as Logger;
const caller = createCallerFactory(router)({ logger, user: { id: crypto.randomUUID() } as AuthUser });

describe("trpc procedures", () => {
  it("reports the rows that the policies reject as a lack of permissions", async () => {
    await expect(caller.rejected()).rejects.toMatchObject({ code: "FORBIDDEN", message: "Insufficient permissions" });
  });

  it("leaves other errors as unexpected ones", async () => {
    await expect(caller.broken()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
