import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "#layers/core/shared/schema";
import { loadSecrets } from "#layers/core/server/lib/secrets";
import { closeDb, createTestDb } from "#layers/core/tests/unit/helpers/db";
import { runtimeConfig } from "#layers/core/tests/unit/helpers/nitro-config";

let db: Kysely<Database>;

const oldKey = (runtimeConfig.encryption as { key: string }).key;
const newKey = "6dD6GxQNdmVfr+G9B6Q9oh5P9I3mL6B8mU3zQ1l6UcA=";

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await closeDb();
});

describe("secret encryption", () => {
  it("decrypts a value only in the context that it was encrypted for", async () => {
    const secrets = await loadSecrets(db, { key: oldKey, previousKey: "" });
    const value = secrets.encrypt("hunter2", "table.column");

    expect(value).not.toContain("hunter2");
    expect(secrets.decrypt(value, "table.column")).toBe("hunter2");
    expect(() => secrets.decrypt(value, "table.other")).toThrow();

    const [format, version, iv = "", ...sealed] = value.split(".");
    const tampered = [format, version, `${iv.startsWith("A") ? "B" : "A"}${iv.slice(1)}`, ...sealed].join(".");
    expect(() => secrets.decrypt(tampered, "table.column")).toThrow();
  });

  it("rotates the main key without encrypting the values again", async () => {
    const value = (await loadSecrets(db, { key: oldKey, previousKey: "" })).encrypt("hunter2", "table.column");

    await expect(loadSecrets(db, { key: newKey, previousKey: "" })).rejects.toThrow(
      "Neither NUXT_ENCRYPTION_KEY nor NUXT_ENCRYPTION_PREVIOUS_KEY",
    );

    const rotated = await loadSecrets(db, { key: newKey, previousKey: oldKey });
    expect(rotated.decrypt(value, "table.column")).toBe("hunter2");

    const withoutOldKey = await loadSecrets(db, { key: newKey, previousKey: "" });
    expect(withoutOldKey.decrypt(value, "table.column")).toBe("hunter2");
  });

  it("rejects the main keys that are not 32 bytes in base64", async () => {
    await expect(loadSecrets(db, { key: "changeme", previousKey: "" })).rejects.toThrow(
      "NUXT_ENCRYPTION_KEY has to be a key of 32 bytes in base64",
    );
    await expect(loadSecrets(db, { key: newKey, previousKey: ` ${oldKey}` })).rejects.toThrow(
      "NUXT_ENCRYPTION_PREVIOUS_KEY has to be a key of 32 bytes in base64",
    );
  });
});
