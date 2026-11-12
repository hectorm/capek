import cluster from "node:cluster";
import { existsSync, readFileSync } from "node:fs";

import { useRuntimeConfig } from "nitropack/runtime/config";
import { defineTask } from "nitropack/runtime/task";
import yaml from "yaml";
import { z } from "zod/v4";

import { AuthModes } from "#layers/core/server/lib/authn/strategies";
import { syncRolePermissions } from "#layers/core/server/lib/authn/sync";
import { useDb } from "#layers/core/server/lib/database";
import { getServerFeatures } from "#layers/core/server/lib/features";
import { assertFeaturePrefix } from "#layers/core/server/lib/features/define";
import { useLogger } from "#layers/core/server/lib/logger";
import { createSeedContext } from "#layers/core/server/lib/seed";
import { Roles } from "#layers/core/shared/rbac";

const config = useRuntimeConfig();
const logger = useLogger();

// Substitutes ${VAR}, ${VAR:-default} and ${VAR-default} with environment variables, and $$ with a literal $
function expandEnvVars(content: string): string {
  return content
    .replace(/\$\$/g, "\x00")
    .replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:)?-(.*?))?\}/gs,
      (_, name: string, colon?: string, fallback?: string) => {
        return (colon && process.env[name] === "" ? undefined : process.env[name]) ?? fallback ?? "";
      },
    )
    .replace(/\x00/g, "$"); // eslint-disable-line no-control-regex
}

export default defineTask({
  meta: {
    name: "database:seed",
    description: "Seed database with initial data",
  },
  async run() {
    if (cluster.isWorker) {
      return { result: true };
    }

    logger.info("Starting database seeding task");

    try {
      const db = await useDb();
      const features = getServerFeatures();

      await db
        .transaction()
        .setIsolationLevel("read committed")
        .execute(async (trx) => {
          // Create permissions
          const permissionNames: string[] = [];
          for (const feature of features) {
            for (const name of feature.permissions ?? []) {
              if (permissionNames.includes(name)) {
                throw new Error(`Duplicate permission "${name}" in feature "${feature.name}"`);
              }
              assertFeaturePrefix(feature.name, name, "Permission");
              permissionNames.push(name);
            }
          }
          if (permissionNames.length > 0) {
            await trx
              .insertInto("permissions")
              .values(permissionNames.map((name) => ({ name })))
              .onConflict((oc) => oc.column("name").doNothing())
              .execute();
          }

          // Collect the permissions granted to each role by all features
          const rolePermissions = new Map<string, string[]>(Object.values(Roles).map((name) => [name, []]));
          for (const feature of features) {
            for (const [roleName, names] of Object.entries(feature.rolePermissions ?? {})) {
              rolePermissions.set(roleName, [...(rolePermissions.get(roleName) ?? []), ...(names ?? [])]);
            }
          }

          // Create roles
          const roleNames = [...rolePermissions.keys()];
          if (roleNames.length > 0) {
            await trx
              .insertInto("roles")
              .values(roleNames.map((name) => ({ name })))
              .onConflict((oc) => oc.column("name").doNothing())
              .execute();
          }

          // Apply permissions to roles
          for (const [roleName, rolePermissionNames] of rolePermissions) {
            const role = await trx
              .selectFrom("roles")
              .select(["id", "name"])
              .where("name", "=", roleName)
              .executeTakeFirstOrThrow();

            await syncRolePermissions(role.id, rolePermissionNames, trx);
          }
        });

      // Ensure single user exists and has admin role if in single user mode
      if (config.authMode === AuthModes.SingleUser) {
        await db
          .transaction()
          .setIsolationLevel("read committed")
          .execute(async (trx) => {
            let singleUser = await trx
              .selectFrom("users")
              .select(["id", "username", "email"])
              .where("username", "=", config.singleUser.username)
              .where("email", "=", config.singleUser.email)
              .executeTakeFirst();

            singleUser ??= await trx
              .insertInto("users")
              .values({
                username: config.singleUser.username,
                fullname: config.singleUser.fullname,
                email: config.singleUser.email,
              })
              .returning(["id", "username", "email"])
              .executeTakeFirstOrThrow();

            await trx
              .insertInto("userRoles")
              .values({
                userId: singleUser.id,
                roleId: trx.selectFrom("roles").select("id").where("name", "=", Roles.Admin),
              })
              .onConflict((oc) => oc.columns(["userId", "roleId"]).doNothing())
              .execute();
          });
      }

      // Core is configured at the root, and every other feature in a section named after it
      const seedShape: Record<string, z.core.$ZodType> = {};
      for (const { name, seed } of features) {
        const shape = name === "core" ? seed?.schema : seed && { [name]: z.object(seed.schema).prefault({}) };
        for (const [key, schema] of Object.entries(shape ?? {})) {
          if (key in seedShape) {
            throw new Error(`Duplicate seed configuration key "${key}" in feature "${name}"`);
          }
          seedShape[key] = schema;
        }
      }

      // Seed resources from configuration
      if (config.seed.config) {
        let seedConfigRaw: unknown;
        if (typeof config.seed.config === "string") {
          const isPath = !/\n|^\s*[[{]/.test(config.seed.config) && existsSync(config.seed.config);
          const raw = isPath ? readFileSync(config.seed.config, "utf-8") : config.seed.config;
          seedConfigRaw = yaml.parse(expandEnvVars(raw));
        } else {
          seedConfigRaw = config.seed.config;
        }
        let seedConfig: Record<string, unknown>;
        try {
          seedConfig = z.object(seedShape).parse(seedConfigRaw);
        } catch (error) {
          logger.error({ error }, "Invalid seed configuration");
          throw new Error("Seed configuration validation failed");
        }

        const ignoredKeys = Object.keys(seedConfigRaw as object).filter((key) => !Object.hasOwn(seedShape, key));
        if (ignoredKeys.length > 0) {
          logger.warn({ keys: ignoredKeys }, "Ignoring seed configuration sections not handled by any feature");
        }

        logger.info("Starting resource seeding from configuration");

        const sectionOf = (name: string): Record<string, unknown> =>
          (name === "core" ? seedConfig : seedConfig[name]) as Record<string, unknown>;

        await db.transaction().execute(async (trx) => {
          const deferred: (() => Promise<void>)[] = [];
          const ctx = createSeedContext(trx, logger, features, (fn) => deferred.push(fn));
          for (const { name, seed } of features) {
            await seed?.run(sectionOf(name), ctx);
          }
          for (const fn of deferred) {
            await fn();
          }
        });

        logger.info("Resource seeding completed successfully");
      }

      logger.info("Database seeding completed");
      return { result: true };
    } catch (error) {
      logger.error({ error }, "Database seeding failed");
      return { result: false, error };
    }
  },
});
