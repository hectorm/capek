import type { Kysely } from "kysely";
import type { Logger } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { SettingKey } from "#layers/core/server/lib/settings/define";
import type { Database } from "#layers/core/shared/schema";
import { getSetting } from "#layers/core/server/lib/settings";
import { createCallerFactory } from "#layers/core/server/trpc/init";
import { settingsRouter } from "#layers/core/server/trpc/routers/settings";
import { CoreRolePermissions, Roles } from "#layers/core/shared/rbac";
import { closeDb, createTestDb } from "#layers/core/tests/unit/helpers/db";

vi.mock("#layers/core/server/lib/features", async () => {
  const { z } = await import("zod/v4");
  const { SettingType } = await import("#layers/core/shared/settings");
  return {
    getServerFeatures: () => [
      {
        name: "test",
        settings: {
          "test.name": {
            type: SettingType.String,
            category: "test",
            isPublic: true,
            getDefault: () => "",
            schema: z.string().max(100),
            config: { inputType: "text", minLength: 0, maxLength: 100 },
          },
          "test.token": {
            type: SettingType.StringSecret,
            category: "test",
            isPublic: true,
            getDefault: () => "",
            schema: z.string().max(100),
            config: { inputType: "password", minLength: 0, maxLength: 100 },
          },
        },
      },
    ],
  };
});

let db: Kysely<Database>;

const SETTING_KEY = "test.token" as SettingKey;
const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined } as unknown as Logger;
const admin = createCallerFactory(settingsRouter)({
  logger,
  user: { id: crypto.randomUUID(), groups: [], permissions: CoreRolePermissions[Roles.Admin] } as unknown as AuthUser,
});

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await closeDb();
});

describe("setting", () => {
  it("is read through a transaction without sharing what the transaction changes", async () => {
    const key = "test.name" as SettingKey;
    expect(await getSetting(key)).toBe("");

    let changed: unknown;
    const rollback = db.transaction().execute(async (trx) => {
      await trx
        .insertInto("settings")
        .values({ key, value: JSON.stringify("Changed") })
        .execute();
      changed = await getSetting(key, trx);
      throw new Error("Rolled back");
    });

    await expect(rollback).rejects.toThrow("Rolled back");
    expect(changed).toBe("Changed");
    expect(await getSetting(key)).toBe("");
  });

  it("is stored encrypted and only read by the server when it is a secret", async () => {
    await admin.update({ settings: [{ key: SETTING_KEY, value: "hunter2" }] });

    const stored = await db
      .selectFrom("settings")
      .select("value")
      .where("key", "=", SETTING_KEY)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(stored.value)).not.toContain("hunter2");
    expect(await getSetting(SETTING_KEY)).toBe("hunter2");
    expect((await admin.list())[SETTING_KEY]).toMatchObject({ value: null, isOverridden: true });
  });
});
