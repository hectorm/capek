import { describe, expect, it } from "vitest";

import { RLSViolationError } from "#layers/core/server/lib/database/errors";
import { createTRPCRouter, protectedProcedure } from "#layers/core/server/trpc/init";
import { createTestCaller } from "#layers/core/tests/unit/helpers/db";

const router = createTRPCRouter({
  rejected: protectedProcedure.query(() => {
    throw new RLSViolationError('new row violates row-level security policy for table "secrets"');
  }),
  broken: protectedProcedure.query(() => {
    throw new Error('relation "secrets" does not exist');
  }),
});

const caller = createTestCaller(router, { id: crypto.randomUUID() });

describe("tRPC procedure", () => {
  it("reports the rows rejected by the policies as a lack of permissions", async () => {
    await expect(caller.rejected()).rejects.toMatchObject({ code: "FORBIDDEN", message: "Insufficient permissions" });
  });

  it("reports other errors as unexpected", async () => {
    await expect(caller.broken()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
