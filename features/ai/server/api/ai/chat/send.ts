import { clearInterval, setInterval } from "node:timers";

import { createError, defineEventHandler, readBody, setResponseHeaders } from "h3";
import { z } from "zod/v4";

import type { ChatStreamError } from "#layers/ai/shared/chat";
import { AgentExecutor } from "#layers/ai/server/lib/agents/executor";
import {
  AbortError,
  ChatMessageNotFoundError,
  ConcurrentExecutionError,
  MaxIterationsError,
  MaxOutputTokensError,
  RefusalError,
  TimeoutError,
} from "#layers/ai/server/lib/errors";
import { AgentResource } from "#layers/ai/server/lib/resources";
import { ChatStreamErrors, ChatStreamEvents } from "#layers/ai/shared/chat";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { requirePermissions } from "#layers/core/server/lib/authz/permissions";
import { usableResourceIds } from "#layers/core/server/lib/authz/resources";
import { withUserTransaction } from "#layers/core/server/lib/database";

const KEEPALIVE_MS = 15_000;

const BodySchema = z.object({
  sessionId: z.uuid(),
  message: z.string().trim().min(1).max(100000),
  userMessageId: z.uuid().optional(),
  assistantMessageId: z.uuid().optional(),
  replaceMessageId: z.uuid().optional(),
});

const errorEvent = (reason: ChatStreamError): string => {
  return `event: ${ChatStreamEvents.Error}\ndata: ${JSON.stringify(reason)}\n\n`;
};

export default defineEventHandler(async (event) => {
  const logger = event.context.logger;

  const user = requirePermissions(event.context.user, [AiPermissions.ChatCreate]);

  const body = BodySchema.safeParse(await readBody<unknown>(event));
  if (!body.success) {
    logger.warn({ userId: user.id, error: body.error }, "Invalid chat request body");
    throw createError({
      statusCode: 400,
      message: "Invalid request body",
    });
  }
  const { sessionId, replaceMessageId } = body.data;

  if (replaceMessageId) {
    requirePermissions(user, [AiPermissions.ChatDeleteAll, AiPermissions.ChatDeleteOwn]);
  }

  const session = await withUserTransaction(
    user,
    async (trx) => {
      const abandoned = await AgentExecutor.failAbandonedExecutions(trx, sessionId);
      if (abandoned > 0) {
        logger.warn({ sessionId, userId: user.id, abandoned }, "Abandoned executions of the session marked as failed");
      }

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

      const usable = await usableResourceIds(trx, AgentResource, [result.agentId]);
      if (usable.length === 0) {
        return { error: "not_found" as const };
      }

      return result;
    },
    { trustedWrites: true },
  );

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
    }
  }

  const abortController = new AbortController();

  event.node.res.on("close", () => {
    abortController.abort();
  });
  if (event.node.res.closed) {
    abortController.abort();
  }

  const executor = new AgentExecutor({ ...body.data, user });

  try {
    await executor.createExecution(session.agentId);
  } catch (error) {
    if (error instanceof ChatMessageNotFoundError) {
      logger.warn({ sessionId, userId: user.id, messageId: replaceMessageId }, "Chat message to replace was not found");
      throw createError({
        statusCode: 404,
        message: error.message,
      });
    }
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
    event.node.res.flushHeaders();

    const keepAlive = setInterval(() => {
      event.node.res.write(":\n\n");
    }, KEEPALIVE_MS);

    try {
      for await (const chunk of executor.executeStream(session.agentId, abortController.signal)) {
        if (abortController.signal.aborted) {
          break;
        }
        event.node.res.write(chunk);
      }

      if (!abortController.signal.aborted) {
        event.node.res.end();
      }

      logger.debug({ sessionId, userId: user.id }, "Agent execution stream completed");
    } catch (error) {
      let reason: ChatStreamError | null = null;
      if (abortController.signal.aborted || error instanceof AbortError) {
        logger.debug({ sessionId, userId: user.id }, "Agent execution aborted");
      } else if (error instanceof TimeoutError) {
        logger.warn({ sessionId, userId: user.id }, "Agent execution timed out");
        reason = ChatStreamErrors.Timeout;
      } else if (error instanceof MaxIterationsError) {
        logger.warn({ sessionId, userId: user.id }, "Agent execution reached max iterations");
        reason = ChatStreamErrors.MaxIterations;
      } else if (error instanceof RefusalError) {
        logger.warn({ sessionId, userId: user.id, error }, "Agent execution declined by the model");
        reason = ChatStreamErrors.Refusal;
      } else if (error instanceof MaxOutputTokensError) {
        logger.warn({ sessionId, userId: user.id }, "Agent execution reached the maximum number of tokens");
        reason = ChatStreamErrors.MaxOutputTokens;
      } else {
        logger.error({ sessionId, userId: user.id, error }, "Agent execution failed");
        reason = ChatStreamErrors.Failed;
      }
      if (reason && !event.node.res.writableEnded) {
        event.node.res.write(errorEvent(reason));
      }
    } finally {
      clearInterval(keepAlive);
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
