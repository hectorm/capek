import { createError, defineEventHandler, readBody, setResponseHeaders } from "h3";
import { z } from "zod/v4";

import { AgentExecutor } from "#layers/ai/server/lib/agents/executor";
import { AbortError, ConcurrentExecutionError, MaxIterationsError, TimeoutError } from "#layers/ai/server/lib/errors";
import { ChatStreamEvents } from "#layers/ai/shared/chat";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { canAny, requirePermissions } from "#layers/core/server/lib/authz/permissions";
import { withUserTransaction } from "#layers/core/server/lib/database";

const bodySchema = z.object({
  sessionId: z.uuid(),
  message: z.string().min(1).max(100000).trim(),
});

const errorEvent = (message: string): string => {
  return `event: ${ChatStreamEvents.Error}\ndata: ${JSON.stringify(message)}\n\n`;
};

export default defineEventHandler(async (event) => {
  const logger = event.context.logger;

  const user = requirePermissions(event.context.user, [AiPermissions.ChatCreate]);

  let sessionId: string;
  let message: string;

  try {
    const rawBody: unknown = await readBody(event);
    const body = bodySchema.parse(rawBody);
    sessionId = body.sessionId;
    message = body.message;
  } catch (error) {
    logger.warn({ userId: user.id, error }, "Invalid chat request body");
    throw createError({
      statusCode: 400,
      message: "Invalid request body",
    });
  }

  const session = await withUserTransaction(user, async (trx) => {
    const activeExecution = await trx
      .selectFrom("aiAgentExecutions")
      .select(["id"])
      .where("sessionId", "=", sessionId)
      .where("status", "=", "running")
      .executeTakeFirst();

    if (activeExecution) {
      return { error: "concurrent" as const };
    }

    const result = await trx
      .selectFrom("aiChatSessions")
      .innerJoin("aiAgents", "aiAgents.id", "aiChatSessions.agentId")
      .select(["aiChatSessions.id", "aiAgents.id as agentId"])
      .where("aiChatSessions.id", "=", sessionId)
      .executeTakeFirst();

    if (!result) {
      return { error: "not_found" as const };
    }

    if (!canAny(user, [AiPermissions.AgentUseAll])) {
      const hasAccess = await trx
        .selectFrom("aiAgentAccess")
        .select(["id"])
        .where("agentId", "=", result.agentId)
        .where((eb) =>
          eb.or([eb("userId", "=", user.id), ...(user.groups.length > 0 ? [eb("groupId", "in", user.groups)] : [])]),
        )
        .executeTakeFirst();

      if (!hasAccess) {
        return { error: "not_found" as const };
      }
    }

    return result;
  });

  if ("error" in session) {
    switch (session.error) {
      case "concurrent":
        logger.warn({ sessionId, userId: user.id }, "An execution is already in progress for this session");
        throw createError({
          statusCode: 409,
          message: "An execution is already in progress for this session",
        });
      case "not_found":
        logger.warn({ sessionId, userId: user.id }, "Chat session not found or has no agent assigned");
        throw createError({
          statusCode: 404,
          message: "Chat session not found or has no agent assigned",
        });
      default:
        logger.error({ sessionId, userId: user.id }, "Unknown error retrieving chat session");
        throw createError({
          statusCode: 500,
          message: "Failed to retrieve chat session",
        });
    }
  }

  const abortController = new AbortController();

  event.node.res.on("close", () => {
    abortController.abort();
  });

  const executor = new AgentExecutor({ sessionId, user, message });

  try {
    await executor.createExecution(session.agentId);
  } catch (error) {
    if (error instanceof ConcurrentExecutionError) {
      logger.warn({ sessionId, userId: user.id }, "An execution is already in progress for this session");
      throw createError({
        statusCode: 409,
        message: "An execution is already in progress for this session",
      });
    }
    logger.error({ sessionId, userId: user.id, error }, "Failed to start agent execution");
    throw createError({
      statusCode: 500,
      message: "Failed to start agent execution",
    });
  }

  try {
    setResponseHeaders(event, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    try {
      for await (const chunk of executor.executeStream(session.agentId, abortController.signal)) {
        if (abortController.signal.aborted) break;
        event.node.res.write(chunk);
      }

      if (!abortController.signal.aborted) {
        event.node.res.end();
      }

      logger.debug({ sessionId, userId: user.id }, "Agent execution stream completed");
    } catch (error) {
      if (error instanceof AbortError) {
        logger.debug({ sessionId, userId: user.id }, "Agent execution aborted");
      } else if (error instanceof TimeoutError) {
        logger.warn({ sessionId, userId: user.id }, "Agent execution timed out");
        if (!event.node.res.writableEnded) {
          event.node.res.write(errorEvent("Agent execution timed out"));
        }
      } else if (error instanceof MaxIterationsError) {
        logger.warn({ sessionId, userId: user.id }, "Agent execution reached max iterations");
        if (!event.node.res.writableEnded) {
          event.node.res.write(errorEvent("Agent execution reached maximum iterations"));
        }
      } else {
        logger.error({ sessionId, userId: user.id, error }, "Agent execution failed");
        if (!event.node.res.writableEnded) {
          event.node.res.write(errorEvent("Agent execution failed"));
        }
      }
    } finally {
      executor.cleanup();
      if (!event.node.res.writableEnded) {
        event.node.res.end();
      }
    }
  } catch (error) {
    if (error instanceof AbortError) {
      logger.debug({ sessionId, userId: user.id }, "Chat request aborted");
      throw createError({
        statusCode: 499,
        message: "Chat request cancelled",
      });
    }

    logger.error({ sessionId, userId: user.id, error }, "Chat request failed");
    throw createError({
      statusCode: 500,
      message: "Failed to process chat request",
    });
  }
});
