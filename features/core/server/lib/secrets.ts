import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import type { Kysely } from "kysely";
import { useRuntimeConfig } from "nitropack/runtime/config";

import type { Database } from "#layers/core/shared/schema";
import { useDb } from "#layers/core/server/lib/database";
import { useLogger } from "#layers/core/server/lib/logger";

const config = useRuntimeConfig();
const logger = useLogger();

const FORMAT = "v1";
const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const DATA_KEY_CONTEXT = "encryption_keys.wrapped_key";
const DEVELOPMENT_KEY = "GIMAxGqsofiyEBw2fzuXw0IiTiDD5vKWDJzYS5FxCyM=";

export interface Secrets {
  // The context, like "table.column", has to be the same to decrypt the value
  encrypt: (value: string, context: string) => string;
  decrypt: (value: string, context: string) => string;
}

const seal = (key: Buffer, plaintext: Buffer, context: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv).setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url")).join(".");
};

const open = (key: Buffer, sealed: string, context: string): Buffer => {
  const [iv, tag, data] = sealed.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !data) {
    throw new Error("Malformed encrypted value");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 }).setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
};

const mainKey = (variable: string, value: string): Buffer => {
  if (!KEY_PATTERN.test(value)) {
    throw new Error(`${variable} has to be a key of 32 bytes in base64, like the ones of "openssl rand -base64 32"`);
  }
  return Buffer.from(value, "base64");
};

const fingerprint = (key: Buffer): string => {
  return createHmac("sha256", key).update("capek encryption key").digest("base64url");
};

interface MainKeys {
  key: string;
  previousKey: string;
}

const loadDataKeys = async (db: Kysely<Database>, keys: MainKeys): Promise<Map<number, Buffer>> => {
  const current = mainKey("NUXT_ENCRYPTION_KEY", keys.key);
  const previous = keys.previousKey ? mainKey("NUXT_ENCRYPTION_PREVIOUS_KEY", keys.previousKey) : undefined;

  await db
    .insertInto("encryptionKeys")
    .values({
      version: 1,
      wrappedKey: seal(current, randomBytes(32), DATA_KEY_CONTEXT),
      mainKeyFingerprint: fingerprint(current),
    })
    .onConflict((oc) => oc.column("version").doNothing())
    .execute();

  const rows = await db.selectFrom("encryptionKeys").select(["version", "wrappedKey", "mainKeyFingerprint"]).execute();

  const dataKeys = new Map<number, Buffer>();
  for (const row of rows) {
    if (row.mainKeyFingerprint === fingerprint(current)) {
      dataKeys.set(row.version, open(current, row.wrappedKey, DATA_KEY_CONTEXT));
    } else if (previous && row.mainKeyFingerprint === fingerprint(previous)) {
      const dataKey = open(previous, row.wrappedKey, DATA_KEY_CONTEXT);
      await db
        .updateTable("encryptionKeys")
        .set({ wrappedKey: seal(current, dataKey, DATA_KEY_CONTEXT), mainKeyFingerprint: fingerprint(current) })
        .where("version", "=", row.version)
        .where("mainKeyFingerprint", "=", row.mainKeyFingerprint)
        .execute();
      dataKeys.set(row.version, dataKey);
      logger.info({ version: row.version }, "Data key encrypted with the new main key");
    } else {
      throw new Error(
        "Neither NUXT_ENCRYPTION_KEY nor NUXT_ENCRYPTION_PREVIOUS_KEY is the key that encrypted the stored data keys",
      );
    }
  }
  return dataKeys;
};

export const loadSecrets = async (db: Kysely<Database>, keys: MainKeys): Promise<Secrets> => {
  const dataKeys = await loadDataKeys(db, keys);
  const version = Math.max(...dataKeys.keys());
  const dataKey = (keyVersion: number): Buffer => {
    const key = dataKeys.get(keyVersion);
    if (!key) {
      throw new Error(`Data key ${String(keyVersion)} not found`);
    }
    return key;
  };

  return {
    encrypt: (value, context) => {
      return [FORMAT, String(version), seal(dataKey(version), Buffer.from(value, "utf8"), context)].join(".");
    },
    decrypt: (value, context) => {
      const [format, keyVersion, ...sealed] = value.split(".");
      if (format !== FORMAT) {
        throw new Error("Malformed encrypted value");
      }
      return open(dataKey(Number(keyVersion)), sealed.join("."), context).toString("utf8");
    },
  };
};

let secrets: Secrets | null = null;

export const loadEncryptionKeys = async (): Promise<void> => {
  if (!config.encryption.key && import.meta.dev) {
    logger.warn("Using the development encryption key, set NUXT_ENCRYPTION_KEY to use another one");
  }
  const key = config.encryption.key || (import.meta.dev ? DEVELOPMENT_KEY : "");
  secrets = await loadSecrets(await useDb(), { key, previousKey: config.encryption.previousKey });
};

export const useSecrets = (): Secrets => {
  if (!secrets) {
    throw new Error("The encryption keys have not been loaded");
  }
  return secrets;
};
