import type { TRPCQueryProcedure } from "@trpc/server";
import type { Kysely } from "kysely";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { SharedResource } from "#layers/core/server/lib/authz/resources";
import type { PermissionName, Principal, PrincipalAccess } from "#layers/core/shared/rbac";
import type { Database } from "#layers/core/shared/schema";
import { listResourceAccess, listResources, syncResourceAccess } from "#layers/core/server/lib/authz/resources";
import { withResourceTransaction } from "#layers/core/server/lib/database";
import { isForeignKeyViolation, isRLSViolation, isUniqueViolation } from "#layers/core/server/lib/database/errors";
import { authorizedProcedure } from "#layers/core/server/trpc/init";
import { PrincipalAccessSchema } from "#layers/core/shared/rbac";

export const ResourceAccessSchema = z.array(PrincipalAccessSchema).max(1000);

export const syncSharedResourceAccess = async (
  trx: Kysely<Database>,
  resource: SharedResource,
  resourceId: string,
  access: readonly PrincipalAccess[] | undefined,
  label: string,
): Promise<void> => {
  if (!access) {
    return;
  }
  try {
    await syncResourceAccess(trx, resource, resourceId, access);
  } catch (error) {
    if (isRLSViolation(error)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `You don't have permission to manage access for this ${label}`,
      });
    }
    if (isForeignKeyViolation(error)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "One or more users or groups do not exist",
      });
    }
    if (isUniqueViolation(error)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Duplicate access entry",
      });
    }
    throw error;
  }
};

export interface SharedResourceAccessProcedures<K extends string> {
  listAccess: TRPCQueryProcedure<{ input: Record<K, string>; output: Principal[]; meta: object }>;
}

// Creates the procedure to list the access entries of a shared resource
export const sharedResourceAccessProcedures = <K extends string>(options: {
  resource: SharedResource;
  // Name of the input field holding the resource ID
  idKey: K;
  // Human readable name of the resource type, used in logs and errors
  label: string;
  readPermissions: PermissionName[];
}): SharedResourceAccessProcedures<K> => {
  const { resource, idKey, label } = options;
  const capitalizedLabel = label.charAt(0).toUpperCase() + label.slice(1);

  // zod cannot infer the output of a generic shape, so the resource ID is read through a cast
  const resourceIdOf = (input: object): string => (input as Record<K, string>)[idKey];

  // The type of the input takes any key, which the return type of the function narrows to the ID key
  const ListAccessInputSchema: z.ZodType<{ resourceId: string }, Record<string, string>> = z
    .object({ [idKey]: z.uuid() })
    .transform((input) => ({ resourceId: resourceIdOf(input) }));

  return {
    listAccess: authorizedProcedure(options.readPermissions)
      .input(ListAccessInputSchema)
      .query(async ({ ctx, input: { resourceId } }) => {
        return withResourceTransaction(ctx.user, resource.type, "read", async (trx) => {
          const [found] = await listResources(trx, resource, { ids: [resourceId] });
          if (!found) {
            ctx.logger.warn({ [idKey]: resourceId }, `${capitalizedLabel} not found`);
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `${capitalizedLabel} not found`,
            });
          }

          const principals = await listResourceAccess(trx, resource, resourceId);
          ctx.logger.debug({ [idKey]: resourceId }, `${capitalizedLabel} access list retrieved`);
          return principals;
        });
      }),
  };
};
