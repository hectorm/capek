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

const key = "test.token" as SettingKey;
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

describe("secret setting", () => {
  it("is stored encrypted and only read by the server", async () => {
    await admin.upsert([{ key, value: "hunter2" }]);

    const stored = await db.selectFrom("settings").select("value").where("key", "=", key).executeTakeFirstOrThrow();
    expect(JSON.stringify(stored.value)).not.toContain("hunter2");
    expect(await getSetting(key)).toBe("hunter2");
    expect((await admin.list())[key]).toMatchObject({ value: null, isOverridden: true });
  });
});
