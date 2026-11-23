import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { SettingKey } from "#layers/core/server/lib/settings/define";
import type { Database } from "#layers/core/shared/schema";
import { getSetting } from "#layers/core/server/lib/settings";
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
        },
      },
    ],
  };
});

let db: Kysely<Database>;

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
});
