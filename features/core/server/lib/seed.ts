import type { Kysely } from "kysely";
import type { Logger } from "pino";
import { z } from "zod/v4";

import type { SharedResource } from "#layers/core/server/lib/authz/resources";
import type { ServerFeature } from "#layers/core/server/lib/features/define";
import type { PrincipalAccess } from "#layers/core/shared/rbac";
import type { Database } from "#layers/core/shared/schema";
import { grantResourceAccess } from "#layers/core/server/lib/authz/resources";

const SeedPrincipalsSchema = z.object({
  users: z.array(z.string().trim().min(1).max(255)).max(255).default([]),
  groups: z.array(z.string().trim().min(1).max(255)).max(255).default([]),
});

export const SeedAccessSchema = z
  .object({ editors: SeedPrincipalsSchema.prefault({}), users: SeedPrincipalsSchema.prefault({}) })
  .prefault({});

export type SeedAccess = z.output<typeof SeedAccessSchema>;

export interface SeedContext {
  db: Kysely<Database>;
  logger: Logger;
  // Server side features of all layers
  features: readonly ServerFeature[];
  // Grants the access described in the seed configuration to a shared resource
  grantAccess: (resource: SharedResource, resourceId: string, access: SeedAccess) => Promise<void>;
  // Runs a function once all features have seeded their resources
  defer: (fn: () => Promise<void>) => void;
}

export interface SeedDefinition<S extends z.ZodRawShape = z.ZodRawShape> {
  // Schema for this feature's seed configuration
  schema: S;
  // Seed handlers must be idempotent
  // eslint-disable-next-line @typescript-eslint/method-signature-style
  run(config: z.output<z.ZodObject<S>>, ctx: SeedContext): Promise<void>;
}

export const defineSeed = <S extends z.ZodRawShape>(seed: SeedDefinition<S>): SeedDefinition<S> => seed;

export const createSeedContext = (
  db: Kysely<Database>,
  logger: Logger,
  features: readonly ServerFeature[],
  defer: SeedContext["defer"],
): SeedContext => {
  // One query resolves all principals. The lookup throws for unknown principals
  const resolveMany = async (
    type: PrincipalAccess["type"],
    names: readonly string[],
  ): Promise<(name: string) => string> => {
    const unique = [...new Set(names)];
    const rows =
      unique.length === 0
        ? []
        : type === "user"
          ? await db.selectFrom("users").where("username", "in", unique).select(["id", "username as name"]).execute()
          : await db.selectFrom("groups").where("name", "in", unique).select(["id", "name"]).execute();
    const ids = new Map(rows.map((row) => [row.name, row.id]));
    return (name) => {
      const id = ids.get(name);
      if (id === undefined) {
        throw new Error(`${type === "user" ? "User" : "Group"} "${name}" not found`);
      }
      return id;
    };
  };

  const grantAccess = async (resource: SharedResource, resourceId: string, access: SeedAccess): Promise<void> => {
    const userId = await resolveMany("user", [...access.editors.users, ...access.users.users]);
    const groupId = await resolveMany("group", [...access.editors.groups, ...access.users.groups]);

    const entries = (["editor", "user"] as const).flatMap((role) => {
      const principals = role === "editor" ? access.editors : access.users;
      return [
        ...principals.users.map((name) => ({ name, access: { id: userId(name), type: "user", role } as const })),
        ...principals.groups.map((name) => ({ name, access: { id: groupId(name), type: "group", role } as const })),
      ];
    });

    await grantResourceAccess(
      db,
      resource,
      resourceId,
      entries.map((entry) => entry.access),
      { ignoreDuplicates: true },
    );

    for (const entry of entries) {
      logger.info(`Granted ${entry.access.role} access to ${entry.access.type}: ${entry.name}`);
    }
  };

  return { db, logger, features, grantAccess, defer };
};
