import type { Logger } from "pino";
import { describe, expect, it } from "vitest";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import { RLSViolationError } from "#layers/core/server/lib/database/errors";
import {
  authorizedProcedure,
  createCallerFactory,
  createTRPCRouter,
  protectedProcedure,
} from "#layers/core/server/trpc/init";
import { CorePermissions } from "#layers/core/shared/rbac";

const router = createTRPCRouter({
  rejected: protectedProcedure.query(() => {
    throw new RLSViolationError('new row violates row-level security policy for table "secrets"');
  }),
  broken: protectedProcedure.query(() => {
    throw new Error('relation "secrets" does not exist');
  }),
  users: authorizedProcedure([CorePermissions.UserReadAll]).query(() => "users"),
});

const logger = { warn: () => undefined } as unknown as Logger;
const createCaller = createCallerFactory(router);
const caller = createCaller({ logger, user: { id: crypto.randomUUID(), permissions: [] } as unknown as AuthUser });

describe("tRPC procedure", () => {
  it("reports the rows rejected by the policies as a lack of permissions", async () => {
    await expect(caller.rejected()).rejects.toMatchObject({ code: "FORBIDDEN", message: "Insufficient permissions" });
  });

  it("reports other errors as unexpected", async () => {
    await expect(caller.broken()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("rejects the calls without a user", async () => {
    const anonymous = createCaller({ logger, user: null });
    await expect(anonymous.broken()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.users()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects the calls without the permissions", async () => {
    await expect(caller.users()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
