import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { SharedResource } from "#layers/core/server/lib/authz/resources";
import type { PermissionName, PrincipalAccess } from "#layers/core/shared/rbac";
import { listResourceAccess, listResources, syncResourceAccess } from "#layers/core/server/lib/authz/resources";
import { withUserTransaction } from "#layers/core/server/lib/database";
import { isForeignKeyViolation, isRLSViolation, isUniqueViolation } from "#layers/core/server/lib/database/errors";
import { authorizedProcedure } from "#layers/core/server/trpc/init";
import { principalAccessSchema } from "#layers/core/shared/rbac";

// Creates the procedures to list and replace the access entries of a shared resource
export const sharedResourceAccessProcedures = <K extends string>(options: {
  resource: SharedResource;
  // Name of the input field holding the resource ID
  idKey: K;
  // Human readable name of the resource type, used in logs and errors
  label: string;
  readPermissions: PermissionName[];
  updatePermissions: PermissionName[];
}) => {
  const { resource, idKey, label } = options;
  const capitalizedLabel = label.charAt(0).toUpperCase() + label.slice(1);

  // zod cannot infer the output of a generic shape, so the resource ID is read through a cast
  const idShape = { [idKey]: z.uuid() } as Record<K, z.ZodUUID>;
  const resourceIdOf = (input: object): string => (input as Record<K, string>)[idKey];

  const listAccessInput = z.object(idShape).transform((input) => ({
    resourceId: resourceIdOf(input),
  }));

  const syncAccessInput = z
    .object({ ...idShape, access: z.array(principalAccessSchema).max(1000) })
    .transform((input) => ({
      resourceId: resourceIdOf(input),
      access: (input as { access: PrincipalAccess[] }).access,
    }));

  return {
    listAccess: authorizedProcedure(options.readPermissions)
      .input(listAccessInput)
      .query(async ({ ctx, input: { resourceId } }) => {
        return withUserTransaction(ctx.user, async (trx) => {
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

    syncAccess: authorizedProcedure(options.updatePermissions)
      .input(syncAccessInput)
      .mutation(async ({ ctx, input: { resourceId, access } }) => {
        return withUserTransaction(ctx.user, async (trx) => {
          try {
            const { added, removed } = await syncResourceAccess(trx, resource, resourceId, access);
            ctx.logger.info({ [idKey]: resourceId, added, removed }, `${capitalizedLabel} access synchronized`);
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
        });
      }),
  };
};
