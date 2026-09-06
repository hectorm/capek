import { createError, defineEventHandler } from "h3";
import { sql } from "kysely";

import { useDb } from "~~/server/lib/database";

export default defineEventHandler(async (event) => {
  const logger = event.context.logger;

  try {
    // eslint-disable-next-line no-restricted-syntax
    const db = await useDb();
    await sql`SELECT 1`.execute(db);
  } catch (error) {
    logger.error({ error }, "Database check error");
    throw createError({
      statusCode: 500,
      message: "Unhealthy",
    });
  }

  return { status: "OK" };
});
