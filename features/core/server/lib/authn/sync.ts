import type { Kysely } from "kysely";

import type { Database, User } from "#layers/core/shared/schema";
import { useDb } from "#layers/core/server/lib/database";
import { syncLinks } from "#layers/core/server/lib/database/links";
import { useLogger } from "#layers/core/server/lib/logger";

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
  emailVerified: boolean;
}

export const getOrCreateUserFromOIDC = async (userInfo: OIDCUserInfo): Promise<User> => {
  const db = await useDb();

  const user: User = await db
    .transaction()
    .setIsolationLevel("read committed")
    .execute(async (trx) => {
      const existingAccount = await trx
        .selectFrom("accounts")
        .select(["userId"])
        .where("iss", "=", userInfo.iss)
        .where("sub", "=", userInfo.sub)
        .executeTakeFirst();

      if (existingAccount) {
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

      // Only a verified email can link a new OIDC identity to an existing user
      const existingUser = userInfo.emailVerified
        ? await trx
            .selectFrom("users")
            .select(["id", "username", "fullname", "email", "picture", "lastLoginAt", "createdAt", "updatedAt"])
            .where("email", "=", userInfo.email)
            .executeTakeFirst()
        : undefined;

      if (existingUser) {
        const [updatedUser] = await Promise.all([
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
      // Email takes precedence. The username still matches after an email change
      const userQuery = trx
        .selectFrom("users")
        .select(["id", "username", "fullname", "email", "picture", "lastLoginAt", "createdAt", "updatedAt"])
        .where((eb) => eb.or([eb("email", "=", userInfo.email), eb("username", "=", userInfo.username)]))
        .orderBy((eb) => eb("email", "=", userInfo.email), "desc");
      const existingUser = await userQuery.executeTakeFirst();

      if (existingUser) {
        if (
          existingUser.username !== userInfo.username ||
          existingUser.fullname !== userInfo.fullname ||
          existingUser.email !== userInfo.email ||
          existingUser.picture !== userInfo.picture
        ) {
          const updatedUser = await trx
            .updateTable("users")
            .set({
              username: userInfo.username,
              fullname: userInfo.fullname,
              email: userInfo.email,
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

      // A concurrent sign-in may have already created the user
      const newUser = await trx
        .insertInto("users")
        .values({
          username: userInfo.username,
          fullname: userInfo.fullname,
          email: userInfo.email,
          picture: userInfo.picture ?? null,
        })
        .onConflict((oc) => oc.doNothing())
        .returning(["id", "username", "fullname", "email", "picture", "lastLoginAt", "createdAt", "updatedAt"])
        .executeTakeFirst();
      if (!newUser) {
        return userQuery.executeTakeFirstOrThrow();
      }

      logger.info({ userId: newUser.id, email: userInfo.email }, "User created via proxy headers");
      return newUser;
    });

  return user;
};

const inTransaction = async (
  db: Kysely<Database> | undefined,
  sync: (trx: Kysely<Database>) => Promise<void>,
): Promise<void> => {
  if (db) {
    await sync(db);
  } else {
    await (await useDb()).transaction().setIsolationLevel("read committed").execute(sync);
  }
};

const logChanges = (context: Record<string, string>, changes: { added: number; removed: number }, message: string) => {
  if (changes.added > 0 || changes.removed > 0) {
    logger.debug({ ...context, ...changes }, message);
  }
};

// Missing groups are created during sync
export const syncUserGroups = (userId: string, groupnames: string[], db?: Kysely<Database>): Promise<void> => {
  return inTransaction(db, async (trx) => {
    let groups: { id: string }[] = [];
    if (groupnames.length > 0) {
      await trx
        .insertInto("groups")
        .values(groupnames.map((name) => ({ name, description: "" })))
        .onConflict((oc) => oc.column("name").doNothing())
        .execute();
      groups = await trx.selectFrom("groups").select(["id"]).where("name", "in", groupnames).execute();
    }

    const changes = await syncLinks(
      trx,
      "user_groups",
      { user_id: userId },
      "group_id",
      groups.map((g) => g.id),
    );
    logChanges({ userId }, changes, "User groups synchronized");
  });
};

// Sync skips unknown roles
export const syncUserRoles = (userId: string, roleNames: string[], db?: Kysely<Database>): Promise<void> => {
  return inTransaction(db, async (trx) => {
    const roles =
      roleNames.length > 0 ? await trx.selectFrom("roles").select(["id"]).where("name", "in", roleNames).execute() : [];

    const changes = await syncLinks(
      trx,
      "user_roles",
      { user_id: userId },
      "role_id",
      roles.map((r) => r.id),
    );
    logChanges({ userId }, changes, "User roles synchronized");
  });
};

// Sync skips unknown roles
export const syncGroupRoles = (groupId: string, roleNames: string[], db?: Kysely<Database>): Promise<void> => {
  return inTransaction(db, async (trx) => {
    const roles =
      roleNames.length > 0 ? await trx.selectFrom("roles").select(["id"]).where("name", "in", roleNames).execute() : [];

    const changes = await syncLinks(
      trx,
      "group_roles",
      { group_id: groupId },
      "role_id",
      roles.map((r) => r.id),
    );
    logChanges({ groupId }, changes, "Group roles synchronized");
  });
};

// Sync skips unknown permissions
export const syncRolePermissions = (
  roleId: string,
  permissionNames: string[],
  db?: Kysely<Database>,
): Promise<void> => {
  return inTransaction(db, async (trx) => {
    const permissions =
      permissionNames.length > 0
        ? await trx.selectFrom("permissions").select(["id"]).where("name", "in", permissionNames).execute()
        : [];

    const changes = await syncLinks(
      trx,
      "role_permissions",
      { role_id: roleId },
      "permission_id",
      permissions.map((p) => p.id),
    );
    logChanges({ roleId }, changes, "Role permissions synchronized");
  });
};
