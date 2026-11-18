import type { Transaction } from "kysely";
import { sql } from "kysely";

import type { Database } from "#layers/core/shared/schema";

// Message IDs break ties when timestamps match
export const deleteChatMessagesFrom = async (
  trx: Transaction<Database>,
  sessionId: string,
  messageId: string,
  role?: "user",
): Promise<boolean> => {
  const deleted = await sql<{ id: string }>`
    WITH deleted AS (
      DELETE FROM ai_chat_messages
      WHERE session_id = ${sessionId} AND (created_at, id) >= (
        SELECT created_at, id FROM ai_chat_messages
        WHERE session_id = ${sessionId} AND id = ${messageId} ${role ? sql`AND role = ${role}` : sql``}
      )
      RETURNING id
    )
    SELECT id FROM deleted WHERE id = ${messageId}
  `.execute(trx);
  return deleted.rows.length === 1;
};
