import type { Kysely } from "kysely";

import type { ChatToolPart } from "#layers/ai/shared/chat";
import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { Database } from "#layers/core/shared/schema";
import type { ToolPart } from "#layers/core/shared/tools";
import { attachTables, discardSessionTables, keepTable, saveSessionTables } from "#layers/ai/server/lib/tables";

export const keepPart = (part: ToolPart): ChatToolPart => (part.type === "table" ? keepTable(part) : part);

export const saveSessionParts = async (parts: ChatToolPart[], sessionId: string, user: AuthUser): Promise<void> => {
  const tables = parts.filter((part) => part.type === "table");
  await saveSessionTables(tables, sessionId, user);
};

export const discardSessionParts = async (sessionId: string, user: AuthUser): Promise<void> => {
  await discardSessionTables(sessionId, user);
};

export const attachParts = async (db: Kysely<Database>, parts: ChatToolPart[], messageId: string): Promise<void> => {
  const tables = parts.filter((part) => part.type === "table");
  await attachTables(db, tables, messageId);
};
