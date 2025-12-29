import type { Kysely, Transaction } from "kysely";

import type { Database, User } from "~~/shared/schema";
import { useDb } from "~~/server/lib/database";
import { useLogger } from "~~/server/lib/logger";

const logger = useLogger();

export interface UserInfo {
  username: string;
  fullname: string;
  email: string;
  picture?: string | null;
}

export interface OIDCUserInfo extends UserInfo {
  iss: string;
  sub: string;
}

export const getOrCreateUserFromOIDC = async (userInfo: OIDCUserInfo): Promise<User> => {
  const db = await useDb();

  const user: User = await db
    .transaction()
    .setIsolationLevel("read committed")
    .execute(async (trx) => {
      // Try to find existing account
      const existingAccount = await trx
        .selectFrom("accounts")
        .select(["userId"])
        .where("iss", "=", userInfo.iss)
        .where("sub", "=", userInfo.sub)
        .executeTakeFirst();

      if (existingAccount) {
        // Update user
        const updatedUser = await trx
          .updateTable("users")
          .set({
            username: userInfo.username,
            fullname: userInfo.fullname,
            email: userInfo.email,
            picture: userInfo.picture ?? null,
            updatedAt: new Date(),
          })
          .where("id", "=", existingAccount.userId)
          .returning(["id", "username", "fullname", "email", "picture", "lastLoginAt", "createdAt", "updatedAt"])
          .executeTakeFirstOrThrow();

        logger.info({ userId: updatedUser.id, email: userInfo.email }, "User updated via OIDC account");
        return updatedUser;
      }

      // Check if user exists by email (for linking existing accounts)
      const existingUser = await trx
        .selectFrom("users")
        .select(["id", "username", "fullname", "email", "picture", "lastLoginAt", "createdAt", "updatedAt"])
        .where("email", "=", userInfo.email)
        .executeTakeFirst();

      if (existingUser) {
        const [updatedUser] = await Promise.all([
          // Update user
          trx
            .updateTable("users")
            .set({
              username: userInfo.username,
              fullname: userInfo.fullname,
              picture: userInfo.picture ?? null,
              updatedAt: new Date(),
            })
            .where("id", "=", existingUser.id)
            .returning(["id", "username", "fullname", "email", "picture", "lastLoginAt", "createdAt", "updatedAt"])
            .executeTakeFirstOrThrow(),
          // Create account
          trx
            .insertInto("accounts")
            .values({
              userId: existingUser.id,
              iss: userInfo.iss,
              sub: userInfo.sub,
            })
            .execute(),
        ]);

        logger.info({ userId: updatedUser.id, email: userInfo.email }, "User linked with OIDC account");
        return updatedUser;
      }

      // Create user
      const newUser = await trx
        .insertInto("users")
        .values({
          username: userInfo.username,
          fullname: userInfo.fullname,
          email: userInfo.email,
          picture: userInfo.picture ?? null,
        })
        .returning(["id", "username", "fullname", "email", "picture", "lastLoginAt", "createdAt", "updatedAt"])
        .executeTakeFirstOrThrow();

      // Create account
      await trx
        .insertInto("accounts")
        .values({
          userId: newUser.id,
          iss: userInfo.iss,
          sub: userInfo.sub,
        })
        .execute();

      logger.info({ userId: newUser.id, email: userInfo.email }, "User created with OIDC account");
      return newUser;
    });

  return user;
};

export const getOrCreateUserFromProxy = async (userInfo: UserInfo): Promise<User> => {
  const db = await useDb();

  const user: User = await db
    .transaction()
    .setIsolationLevel("read committed")
    .execute(async (trx) => {
      // Look up user by email
      const existingUser = await trx
        .selectFrom("users")
        .select(["id", "username", "fullname", "email", "picture", "lastLoginAt", "createdAt", "updatedAt"])
        .where("email", "=", userInfo.email)
        .executeTakeFirst();

      if (existingUser) {
        // Update user info if changed
        if (
          existingUser.username !== userInfo.username ||
          existingUser.fullname !== userInfo.fullname ||
          existingUser.picture !== userInfo.picture
        ) {
          const updatedUser = await trx
            .updateTable("users")
            .set({
              username: userInfo.username,
              fullname: userInfo.fullname,
              picture: userInfo.picture ?? null,
              updatedAt: new Date(),
            })
            .where("id", "=", existingUser.id)
            .returning(["id", "username", "fullname", "email", "picture", "lastLoginAt", "createdAt", "updatedAt"])
            .executeTakeFirstOrThrow();

          logger.info({ userId: updatedUser.id, email: userInfo.email }, "User updated via proxy headers");
          return updatedUser;
        }

        return existingUser;
      }

      // Create user
      const newUser = await trx
        .insertInto("users")
        .values({
          username: userInfo.username,
          fullname: userInfo.fullname,
          email: userInfo.email,
          picture: userInfo.picture ?? null,
        })
        .returning(["id", "username", "fullname", "email", "picture", "lastLoginAt", "createdAt", "updatedAt"])
        .executeTakeFirstOrThrow();

      logger.info({ userId: newUser.id, email: userInfo.email }, "User created via proxy headers");
      return newUser;
    });

  return user;
};

export const syncUserGroups = async (
  userId: string,
  groupnames: string[],
  dbOrTrx?: Kysely<Database> | Transaction<Database>,
): Promise<void> => {
  const sync = async (trx: Kysely<Database> | Transaction<Database>) => {
    const currentGroups = await trx
      .selectFrom("userGroups")
      .innerJoin("groups", "groups.id", "userGroups.groupId")
      .select(["groups.id", "groups.name"])
      .where("userGroups.userId", "=", userId)
      .execute();

    if (groupnames.length === 0) {
      if (currentGroups.length > 0) {
        await trx.deleteFrom("userGroups").where("userId", "=", userId).execute();
      }
      return;
    }

    await trx
      .insertInto("groups")
      .values(groupnames.map((name) => ({ name, description: "" })))
      .onConflict((oc) => oc.column("name").doNothing())
      .execute();

    const targetGroups = await trx
      .selectFrom("groups")
      .select(["id", "name"])
      .where("name", "in", groupnames)
      .execute();

    const currentGroupIds = new Set(currentGroups.map((g) => g.id));
    const targetGroupIds = new Set(targetGroups.map((g) => g.id));

    const groupsToRemove = currentGroups.filter((g) => !targetGroupIds.has(g.id));
    const groupsToAdd = targetGroups.filter((g) => !currentGroupIds.has(g.id));

    if (logger.isLevelEnabled("debug")) {
      if (groupsToRemove.length > 0) {
        const removedGroupNames = groupsToRemove.map((g) => g.name);
        logger.debug({ userId, groups: removedGroupNames }, "User removed from groups");
      }
      if (groupsToAdd.length > 0) {
        const addedGroupNames = groupsToAdd.map((g) => g.name);
        logger.debug({ userId, groups: addedGroupNames }, "User added to groups");
      }
    }

    if (groupsToRemove.length > 0 || groupsToAdd.length > 0) {
      const ops = [];
      if (groupsToRemove.length > 0) {
        const groupIds = groupsToRemove.map((g) => g.id);
        ops.push(trx.deleteFrom("userGroups").where("userId", "=", userId).where("groupId", "in", groupIds).execute());
      }
      if (groupsToAdd.length > 0) {
        const userGroups = groupsToAdd.map((g) => ({ userId, groupId: g.id }));
        ops.push(trx.insertInto("userGroups").values(userGroups).execute());
      }
      await Promise.all(ops);
    }
  };

  if (dbOrTrx) {
    await sync(dbOrTrx);
  } else {
    const db = await useDb();
    await db.transaction().setIsolationLevel("read committed").execute(sync);
  }
};

export const syncUserRoles = async (
  userId: string,
  roleNames: string[],
  dbOrTrx?: Kysely<Database> | Transaction<Database>,
): Promise<void> => {
  const sync = async (trx: Kysely<Database> | Transaction<Database>) => {
    const currentRoles = await trx
      .selectFrom("userRoles")
      .innerJoin("roles", "roles.id", "userRoles.roleId")
      .select(["roles.id", "roles.name"])
      .where("userRoles.userId", "=", userId)
      .execute();

    if (roleNames.length === 0) {
      if (currentRoles.length > 0) {
        await trx.deleteFrom("userRoles").where("userId", "=", userId).execute();
      }
      return;
    }

    const targetRoles = await trx.selectFrom("roles").select(["id", "name"]).where("name", "in", roleNames).execute();

    const currentRoleIds = new Set(currentRoles.map((r) => r.id));
    const targetRoleIds = new Set(targetRoles.map((r) => r.id));

    const rolesToRemove = currentRoles.filter((r) => !targetRoleIds.has(r.id));
    const rolesToAdd = targetRoles.filter((r) => !currentRoleIds.has(r.id));

    if (logger.isLevelEnabled("debug")) {
      if (rolesToRemove.length > 0) {
        const removedRoleNames = rolesToRemove.map((r) => r.name);
        logger.debug({ userId, roles: removedRoleNames }, "User roles removed");
      }
      if (rolesToAdd.length > 0) {
        const addedRoleNames = rolesToAdd.map((r) => r.name);
        logger.debug({ userId, roles: addedRoleNames }, "User roles added");
      }
    }

    if (rolesToRemove.length > 0 || rolesToAdd.length > 0) {
      const ops = [];
      if (rolesToRemove.length > 0) {
        const roleIds = rolesToRemove.map((r) => r.id);
        ops.push(trx.deleteFrom("userRoles").where("userId", "=", userId).where("roleId", "in", roleIds).execute());
      }
      if (rolesToAdd.length > 0) {
        const userRoles = rolesToAdd.map((r) => ({ userId, roleId: r.id }));
        ops.push(trx.insertInto("userRoles").values(userRoles).execute());
      }
      await Promise.all(ops);
    }
  };

  if (dbOrTrx) {
    await sync(dbOrTrx);
  } else {
    const db = await useDb();
    await db.transaction().setIsolationLevel("read committed").execute(sync);
  }
};

export const syncGroupRoles = async (
  groupId: string,
  roleNames: string[],
  dbOrTrx?: Kysely<Database> | Transaction<Database>,
): Promise<void> => {
  const sync = async (trx: Kysely<Database> | Transaction<Database>) => {
    const currentRoles = await trx
      .selectFrom("groupRoles")
      .innerJoin("roles", "roles.id", "groupRoles.roleId")
      .select(["roles.id", "roles.name"])
      .where("groupRoles.groupId", "=", groupId)
      .execute();

    if (roleNames.length === 0) {
      if (currentRoles.length > 0) {
        await trx.deleteFrom("groupRoles").where("groupId", "=", groupId).execute();
      }
      return;
    }

    const targetRoles = await trx.selectFrom("roles").select(["id", "name"]).where("name", "in", roleNames).execute();

    const currentRoleIds = new Set(currentRoles.map((r) => r.id));
    const targetRoleIds = new Set(targetRoles.map((r) => r.id));

    const rolesToRemove = currentRoles.filter((r) => !targetRoleIds.has(r.id));
    const rolesToAdd = targetRoles.filter((r) => !currentRoleIds.has(r.id));

    if (logger.isLevelEnabled("debug")) {
      if (rolesToRemove.length > 0) {
        const removedRoleNames = rolesToRemove.map((r) => r.name);
        logger.debug({ groupId, roles: removedRoleNames }, "Group roles removed");
      }
      if (rolesToAdd.length > 0) {
        const addedRoleNames = rolesToAdd.map((r) => r.name);
        logger.debug({ groupId, roles: addedRoleNames }, "Group roles added");
      }
    }

    if (rolesToRemove.length > 0 || rolesToAdd.length > 0) {
      const ops = [];
      if (rolesToRemove.length > 0) {
        const roleIds = rolesToRemove.map((r) => r.id);
        ops.push(trx.deleteFrom("groupRoles").where("groupId", "=", groupId).where("roleId", "in", roleIds).execute());
      }
      if (rolesToAdd.length > 0) {
        const groupRoles = rolesToAdd.map((r) => ({ groupId, roleId: r.id }));
        ops.push(trx.insertInto("groupRoles").values(groupRoles).execute());
      }
      await Promise.all(ops);
    }
  };

  if (dbOrTrx) {
    await sync(dbOrTrx);
  } else {
    const db = await useDb();
    await db.transaction().setIsolationLevel("read committed").execute(sync);
  }
};

export const syncRolePermissions = async (
  roleId: string,
  permissionNames: string[],
  dbOrTrx?: Kysely<Database> | Transaction<Database>,
): Promise<void> => {
  const sync = async (trx: Kysely<Database> | Transaction<Database>) => {
    const currentPermissions = await trx
      .selectFrom("rolePermissions")
      .innerJoin("permissions", "permissions.id", "rolePermissions.permissionId")
      .select(["permissions.id", "permissions.name"])
      .where("rolePermissions.roleId", "=", roleId)
      .execute();

    if (permissionNames.length === 0) {
      if (currentPermissions.length > 0) {
        await trx.deleteFrom("rolePermissions").where("roleId", "=", roleId).execute();
      }
      return;
    }

    const targetPermissions = await trx
      .selectFrom("permissions")
      .select(["id", "name"])
      .where("name", "in", permissionNames)
      .execute();

    const currentPermissionIds = new Set(currentPermissions.map((p) => p.id));
    const targetPermissionIds = new Set(targetPermissions.map((p) => p.id));

    const permissionsToRemove = currentPermissions.filter((p) => !targetPermissionIds.has(p.id));
    const permissionsToAdd = targetPermissions.filter((p) => !currentPermissionIds.has(p.id));

    if (logger.isLevelEnabled("debug")) {
      if (permissionsToRemove.length > 0) {
        const removedPermissionNames = permissionsToRemove.map((p) => p.name);
        logger.debug({ roleId, permissions: removedPermissionNames }, "Role permissions removed");
      }
      if (permissionsToAdd.length > 0) {
        const addedPermissionNames = permissionsToAdd.map((p) => p.name);
        logger.debug({ roleId, permissions: addedPermissionNames }, "Role permissions added");
      }
    }

    if (permissionsToRemove.length > 0 || permissionsToAdd.length > 0) {
      const ops = [];
      if (permissionsToRemove.length > 0) {
        const permissionIds = permissionsToRemove.map((p) => p.id);
        ops.push(
          trx
            .deleteFrom("rolePermissions")
            .where("roleId", "=", roleId)
            .where("permissionId", "in", permissionIds)
            .execute(),
        );
      }
      if (permissionsToAdd.length > 0) {
        const rolePermissions = permissionsToAdd.map((p) => ({ roleId, permissionId: p.id }));
        ops.push(trx.insertInto("rolePermissions").values(rolePermissions).execute());
      }
      await Promise.all(ops);
    }
  };

  if (dbOrTrx) {
    await sync(dbOrTrx);
  } else {
    const db = await useDb();
    await db.transaction().setIsolationLevel("read committed").execute(sync);
  }
};
