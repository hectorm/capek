import { z } from "zod/v4";

import { defineSeed } from "#layers/core/server/lib/seed";

const seedUserSchema = z.object({
  username: z.string().trim().min(1).max(255),
  fullname: z.string().trim().min(1).max(255),
  email: z.email({ pattern: z.regexes.unicodeEmail }).max(255).trim().toLowerCase(),
  roles: z.array(z.string().trim().min(1).max(255).toLowerCase()).max(255).default([]),
  groups: z.array(z.string().trim().min(1).max(255)).max(255).default([]),
});

const seedGroupSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().max(1000).trim().default(""),
  roles: z.array(z.string().trim().min(1).max(255).toLowerCase()).max(255).default([]),
});

export const coreSeed = defineSeed({
  schema: {
    users: z.array(seedUserSchema).max(10000).default([]),
    groups: z.array(seedGroupSchema).max(10000).default([]),
  },
  async run(config, { db, logger }) {
    // Seed users (idempotent by username)
    const userIds = new Map<string, string>();
    for (const userConfig of config.users) {
      const existing = await db
        .selectFrom("users")
        .where("username", "=", userConfig.username)
        .select("id")
        .executeTakeFirst();

      if (existing) {
        logger.info(`User "${userConfig.username}" already exists, skipping`);
      } else {
        const user = await db
          .insertInto("users")
          .values({
            username: userConfig.username,
            fullname: userConfig.fullname,
            email: userConfig.email,
          })
          .returning(["id", "username"])
          .executeTakeFirstOrThrow();

        logger.info(`Created user: ${user.username}`);
        userIds.set(user.username, user.id);

        // Assign roles to user
        for (const roleName of userConfig.roles) {
          const role = await db.selectFrom("roles").where("name", "=", roleName).select("id").executeTakeFirst();
          if (!role) {
            throw new Error(`Role "${roleName}" not found for user "${userConfig.username}"`);
          }

          await db
            .insertInto("userRoles")
            .values({ userId: user.id, roleId: role.id })
            .onConflict((oc) => oc.doNothing())
            .execute();
          logger.info(`Assigned role "${roleName}" to user "${user.username}"`);
        }
      }
    }

    // Seed groups (idempotent by name)
    const groupIds = new Map<string, string>();
    for (const groupConfig of config.groups) {
      const existing = await db
        .selectFrom("groups")
        .where("name", "=", groupConfig.name)
        .select("id")
        .executeTakeFirst();

      if (existing) {
        logger.info(`Group "${groupConfig.name}" already exists, skipping`);
        groupIds.set(groupConfig.name, existing.id);
      } else {
        const group = await db
          .insertInto("groups")
          .values({
            name: groupConfig.name,
            description: groupConfig.description,
          })
          .returning(["id", "name"])
          .executeTakeFirstOrThrow();

        logger.info(`Created group: ${group.name}`);
        groupIds.set(group.name, group.id);

        // Assign roles to group
        for (const roleName of groupConfig.roles) {
          const role = await db.selectFrom("roles").where("name", "=", roleName).select("id").executeTakeFirst();
          if (!role) {
            throw new Error(`Role "${roleName}" not found for group "${groupConfig.name}"`);
          }

          await db
            .insertInto("groupRoles")
            .values({ groupId: group.id, roleId: role.id })
            .onConflict((oc) => oc.doNothing())
            .execute();
          logger.info(`Assigned role "${roleName}" to group "${group.name}"`);
        }
      }
    }

    // Add users to groups
    for (const userConfig of config.users) {
      const userId = userIds.get(userConfig.username);
      if (!userId) {
        continue; // User already existed, skip group assignment
      }

      for (const groupname of userConfig.groups) {
        const groupId = groupIds.get(groupname);
        if (!groupId) {
          // Try to find group in database (might have been created in previous run)
          const group = await db.selectFrom("groups").where("name", "=", groupname).select("id").executeTakeFirst();
          if (!group) {
            throw new Error(`Group "${groupname}" not found for user "${userConfig.username}"`);
          }
          groupIds.set(groupname, group.id);
        }

        const resolvedGroupId = groupIds.get(groupname);
        if (!resolvedGroupId) {
          throw new Error(`Group ID not found for "${groupname}"`);
        }

        await db
          .insertInto("userGroups")
          .values({ userId, groupId: resolvedGroupId })
          .onConflict((oc) => oc.doNothing())
          .execute();
        logger.info(`Added user "${userConfig.username}" to group "${groupname}"`);
      }
    }
  },
});
