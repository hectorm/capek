import { useNuxtApp } from "nuxt/app";
import { defineStore } from "pinia";
import { computed, ref, shallowRef, triggerRef } from "vue";

import type { ChatMessagePart, ChatStreamError } from "#layers/ai/shared/chat";
import type { ChatSession } from "#layers/ai/shared/schema";
import type { RouterOutputs } from "#layers/core/app/types/trpc";
import { ChatStreamErrors, ChatStreamEvents } from "#layers/ai/shared/chat";
import { randomUUID } from "#layers/core/app/utils/uuid";

type ChatMessage = RouterOutputs["ai"]["chatMessage"]["list"]["messages"][number];
type MessagesCursor = RouterOutputs["ai"]["chatMessage"]["list"]["nextCursor"];

interface StreamState {
  controller: AbortController;
  tempUserMessageId: string;
  tempAssistantMessageId: string;
  status: string;
}

interface SearchQuery {
  search?: string | string[];
  searchBy?: "title";
  order?: "asc" | "desc";
  orderBy?: "title" | "updatedAt" | "createdAt";
  limit?: number;
}

export class ChatAnswerError extends Error {
  public readonly reason: ChatStreamError;

  public constructor(reason: ChatStreamError) {
    super(`The answer failed: ${reason}`);
    this.name = "ChatAnswerError";
    this.reason = reason;
  }
}

export const useChatStore = defineStore("ai.chat", () => {
  const { $trpc } = useNuxtApp();

  const sessions = ref<ChatSession[]>([]);
  const openedSession = ref<ChatSession | null>(null);
  const currentSessionId = ref<string | null>(null);
  const messages = shallowRef<Map<string, ChatMessage[]>>(new Map());
  const messagesNextCursors = ref<Map<string, MessagesCursor>>(new Map());
  const activeStreams = ref<Map<string, StreamState>>(new Map());
  const unsentMessageIds = new Set<string>();
  const isLoadingSessions = ref<boolean>(false);
  const isLoadingMessages = ref<boolean>(false);
  const isCreatingSession = ref<boolean>(false);
  const sessionsNextCursor = ref<RouterOutputs["ai"]["chatSession"]["search"]["nextCursor"]>(undefined);
  const sessionsQuery = ref<SearchQuery>({});

  const findSession = (sessionId: string): ChatSession | undefined => {
    return (
      sessions.value.find((s) => s.id === sessionId) ??
      (openedSession.value?.id === sessionId ? openedSession.value : undefined)
    );
  };

  const replaceSession = (session: ChatSession): void => {
    sessions.value = sessions.value.map((s) => (s.id === session.id ? session : s));
    if (openedSession.value?.id === session.id) {
      openedSession.value = session;
    }
  };

  const currentSession = computed(() => {
    if (!currentSessionId.value) {
      return null;
    }
    return findSession(currentSessionId.value) ?? null;
  });

  const currentMessages = computed(() => {
    if (!currentSessionId.value) {
      return [];
    }
    return messages.value.get(currentSessionId.value) ?? [];
  });

  const fetchSessions = async (): Promise<void> => {
    isLoadingSessions.value = true;

    try {
      const result = await $trpc.ai.chatSession.search.query({});
      sessions.value = result.sessions;
      sessionsNextCursor.value = result.nextCursor;
      sessionsQuery.value = {};
    } catch (error) {
      throw new Error("Failed to fetch chat sessions", { cause: error });
    } finally {
      isLoadingSessions.value = false;
    }
  };

  const searchSessions = async (query: SearchQuery): Promise<void> => {
    isLoadingSessions.value = true;

    try {
      const result = await $trpc.ai.chatSession.search.query(query);
      sessions.value = result.sessions;
      sessionsNextCursor.value = result.nextCursor;
      sessionsQuery.value = query;
    } catch (error) {
      throw new Error("Failed to search chat sessions", { cause: error });
    } finally {
      isLoadingSessions.value = false;
    }
  };

  const loadMoreSessions = async (): Promise<void> => {
    if (!sessionsNextCursor.value || isLoadingSessions.value) {
      return;
    }

    isLoadingSessions.value = true;

    try {
      const result = await $trpc.ai.chatSession.search.query({
        ...sessionsQuery.value,
        cursor: sessionsNextCursor.value,
      });
      sessions.value = sessions.value.concat(result.sessions);
      sessionsNextCursor.value = result.nextCursor;
    } catch (error) {
      throw new Error("Failed to load more chat sessions", { cause: error });
    } finally {
      isLoadingSessions.value = false;
    }
  };

  const hasMoreSessions = computed(() => sessionsNextCursor.value != null);

  const createSession = async (title?: string, agentId?: string): Promise<ChatSession> => {
    isCreatingSession.value = true;

    try {
      const session = await $trpc.ai.chatSession.create.mutate({ title, agentId });
      sessions.value = [session, ...sessions.value];
      messages.value.set(session.id, []);
      triggerRef(messages);
      currentSessionId.value = session.id;

      // Fetch messages immediately to show greeting if present
      await fetchMessages(session.id);

      return session;
    } catch (error) {
      throw new Error("Failed to create chat session", { cause: error });
    } finally {
      isCreatingSession.value = false;
    }
  };

  const updateSession = async (sessionId: string, data: { title?: string; agentId?: string | null }): Promise<void> => {
    if (!findSession(sessionId)) {
      throw new Error("Session not found");
    }

    try {
      const session = await $trpc.ai.chatSession.update.mutate({
        id: sessionId,
        title: data.title,
        agentId: data.agentId ?? undefined,
      });
      replaceSession(session);
    } catch (error) {
      throw new Error("Failed to update chat session", { cause: error });
    }
  };

  const autoRenameSession = async (sessionId: string): Promise<void> => {
    if (!findSession(sessionId)) {
      throw new Error("Session not found");
    }

    try {
      const session = await $trpc.ai.chatSession.autoRename.mutate({ id: sessionId });
      replaceSession(session);
    } catch (error) {
      throw new Error("Failed to auto-rename chat session", { cause: error });
    }
  };

  const deleteSession = async (sessionId: string): Promise<void> => {
    abortStream(sessionId);

    try {
      await $trpc.ai.chatSession.delete.mutate({ id: sessionId });
      sessions.value = sessions.value.filter((s) => s.id !== sessionId);
      if (openedSession.value?.id === sessionId) {
        openedSession.value = null;
      }
      messages.value.delete(sessionId);
      messagesNextCursors.value.delete(sessionId);
      triggerRef(messages);
      if (currentSessionId.value === sessionId) {
        currentSessionId.value = null;
      }
    } catch (error) {
      throw new Error("Failed to delete chat session", { cause: error });
    }
  };

  const selectSession = async (sessionId: string): Promise<void> => {
    currentSessionId.value = sessionId;
    if (!sessions.value.some((s) => s.id === sessionId)) {
      openedSession.value = await $trpc.ai.chatSession.read.query({ id: sessionId });
    }
    if (!activeStreams.value.has(sessionId)) {
      await fetchMessages(sessionId);
    }
  };

  const fetchMessages = async (sessionId: string): Promise<void> => {
    isLoadingMessages.value = true;
    const stream = activeStreams.value.get(sessionId);

    try {
      const result = await $trpc.ai.chatMessage.list.query({ sessionId });
      const currentStream = activeStreams.value.get(sessionId);
      if (currentStream && currentStream !== stream) {
        return;
      }
      messages.value.set(sessionId, result.messages);
      messagesNextCursors.value.set(sessionId, result.nextCursor);
      triggerRef(messages);
    } catch (error) {
      throw new Error("Failed to fetch messages", { cause: error });
    } finally {
      isLoadingMessages.value = false;
    }
  };

  const loadOlderMessages = async (sessionId: string): Promise<void> => {
    const cursor = messagesNextCursors.value.get(sessionId);
    if (!cursor || isLoadingMessages.value) {
      return;
    }

    isLoadingMessages.value = true;

    try {
      const result = await $trpc.ai.chatMessage.list.query({ sessionId, cursor });
      if (messagesNextCursors.value.get(sessionId) !== cursor) {
        return;
      }
      messages.value.set(sessionId, [...result.messages, ...(messages.value.get(sessionId) ?? [])]);
      messagesNextCursors.value.set(sessionId, result.nextCursor);
      triggerRef(messages);
    } catch (error) {
      throw new Error("Failed to load older messages", { cause: error });
    } finally {
      isLoadingMessages.value = false;
    }
  };

  const hasOlderMessages = (sessionId: string): boolean => messagesNextCursors.value.get(sessionId) != null;

  const sendMessage = async (sessionId: string, content: string): Promise<void> => {
    const controller = new AbortController();
    const tempUserMessageId = randomUUID();
    const tempAssistantMessageId = randomUUID();

    const streamState: StreamState = {
      controller,
      tempUserMessageId,
      tempAssistantMessageId,
      status: "",
    };
    activeStreams.value.set(sessionId, streamState);

    const now = new Date();
    const tempUserMessage: ChatMessage = {
      id: tempUserMessageId,
      sessionId,
      role: "user",
      content,
      parts: [{ type: "text", text: content }],
      createdAt: now,
      updatedAt: now,
    };

    const tempAssistantMessage: ChatMessage = {
      id: tempAssistantMessageId,
      sessionId,
      role: "assistant",
      content: "",
      parts: [],
      createdAt: now,
      updatedAt: now,
    };

    const currentMsgs = messages.value.get(sessionId) ?? [];
    messages.value.set(sessionId, [...currentMsgs, tempUserMessage, tempAssistantMessage]);
    triggerRef(messages);

    const shouldAutoRename = currentSession.value?.title === "" && !currentMsgs.some((m) => m.role === "user");

    let textEnded = false;

    const onStreamComplete = () => {
      void fetchMessages(sessionId);
      void fetchSessions();
      if (shouldAutoRename) {
        autoRenameSession(sessionId).catch((error: unknown) => {
          console.warn("Failed to auto-rename chat session", error);
        });
      }
    };

    try {
      const response = await fetch("/api/ai/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          message: content,
          userMessageId: tempUserMessageId,
          assistantMessageId: tempAssistantMessageId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to send message: ${errorText}`);
      }

      if (response.headers.get("Content-Type")?.includes("text/event-stream") && response.body) {
        await handleStreamResponse(response.body, {
          signal: controller.signal,
          onStatus: (status) => {
            textEnded = true;
            const state = activeStreams.value.get(sessionId);
            if (state) {
              state.status = status;
            }
          },
          onChunk: (chunk) => {
            const msgs = messages.value.get(sessionId);
            if (!msgs) {
              return;
            }

            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg?.id === tempAssistantMessageId) {
              const lastPart = lastMsg.parts.at(-1);
              const parts: ChatMessagePart[] =
                lastPart?.type === "text" && !textEnded
                  ? [...lastMsg.parts.slice(0, -1), { type: "text", text: lastPart.text + chunk }]
                  : [...lastMsg.parts, { type: "text", text: chunk }];
              textEnded = false;
              const updatedMsg = { ...lastMsg, content: lastMsg.content + chunk, parts };
              messages.value.set(sessionId, [...msgs.slice(0, -1), updatedMsg]);
              triggerRef(messages);
            }
          },
          onPart: (part) => {
            const msgs = messages.value.get(sessionId);
            if (!msgs) {
              return;
            }

            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg?.id === tempAssistantMessageId) {
              const updatedMsg = { ...lastMsg, parts: [...lastMsg.parts, part] };
              messages.value.set(sessionId, [...msgs.slice(0, -1), updatedMsg]);
              triggerRef(messages);
            }
          },
          onError: (reason) => {
            throw new ChatAnswerError(reason);
          },
        });
      } else {
        await response.json();
      }

      onStreamComplete();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        onStreamComplete();
        return;
      }

      await fetchMessages(sessionId);

      const updatedMsgs = messages.value.get(sessionId) ?? [];
      const lastUserMsg = updatedMsgs.findLast((m) => m.role === "user");

      if (!lastUserMsg?.content || lastUserMsg.content !== content) {
        const preservedNow = new Date();
        const preservedUserMessage: ChatMessage = {
          id: tempUserMessageId,
          sessionId,
          role: "user",
          content,
          parts: [{ type: "text", text: content }],
          createdAt: preservedNow,
          updatedAt: preservedNow,
        };
        messages.value.set(sessionId, [...updatedMsgs, preservedUserMessage]);
        triggerRef(messages);
        unsentMessageIds.add(tempUserMessageId);
      }

      throw new Error("Failed to send message", { cause: error });
    } finally {
      activeStreams.value.delete(sessionId);
    }
  };

  const deleteMessagesFrom = async (sessionId: string, messageId: string): Promise<void> => {
    if (!unsentMessageIds.delete(messageId)) {
      await $trpc.ai.chatMessage.delete.mutate({ id: messageId, sessionId });
    }
  };

  const retryMessage = async (sessionId: string, messageId: string): Promise<void> => {
    const msgs = messages.value.get(sessionId) ?? [];
    const messageIndex = msgs.findLastIndex((m) => m.id === messageId);

    if (messageIndex === -1) {
      throw new Error("Message not found");
    }

    const message = msgs[messageIndex];
    if (!message) {
      throw new Error("Message not found");
    }

    const userMessageContent = message.content;

    try {
      await deleteMessagesFrom(sessionId, messageId);
    } catch (error) {
      await fetchMessages(sessionId);
      throw new Error("Failed to retry message", { cause: error });
    }

    messages.value.set(sessionId, msgs.slice(0, messageIndex));
    triggerRef(messages);
    await sendMessage(sessionId, userMessageContent);
  };

  const regenerateMessage = async (sessionId: string, messageId: string): Promise<void> => {
    const msgs = messages.value.get(sessionId) ?? [];
    const messageIndex = msgs.findLastIndex((m) => m.id === messageId);

    if (messageIndex === -1) {
      throw new Error("Message not found");
    }

    const previousUserMessage = msgs.slice(0, messageIndex).findLast((m) => m.role === "user");
    if (!previousUserMessage) {
      // Edge case, this means the first message is an assistant message
      return;
    }

    await retryMessage(sessionId, previousUserMessage.id);
  };

  const deleteMessage = async (sessionId: string, messageId: string): Promise<void> => {
    const msgs = messages.value.get(sessionId) ?? [];
    const messageIndex = msgs.findLastIndex((m) => m.id === messageId);

    if (messageIndex === -1) {
      throw new Error("Message not found");
    }

    try {
      await deleteMessagesFrom(sessionId, messageId);
      messages.value.set(sessionId, msgs.slice(0, messageIndex));
      triggerRef(messages);
    } catch (error) {
      await fetchMessages(sessionId);
      throw new Error("Failed to delete message", { cause: error });
    }
  };

  const editMessage = async (sessionId: string, messageId: string): Promise<string> => {
    const msgs = messages.value.get(sessionId) ?? [];
    const messageIndex = msgs.findLastIndex((m) => m.id === messageId);

    if (messageIndex === -1 || !msgs[messageIndex]) {
      throw new Error("Message not found");
    }

    const messageContent = msgs[messageIndex].content;

    try {
      await deleteMessagesFrom(sessionId, messageId);
      messages.value.set(sessionId, msgs.slice(0, messageIndex));
      triggerRef(messages);
      return messageContent;
    } catch (error) {
      await fetchMessages(sessionId);
      throw new Error("Failed to edit message", { cause: error });
    }
  };

  const getStream = (sessionId: string): StreamState | undefined => {
    return activeStreams.value.get(sessionId);
  };

  const abortStream = (sessionId: string): boolean => {
    const streamState = activeStreams.value.get(sessionId);
    if (!streamState) {
      return false;
    }

    streamState.status = "";
    streamState.controller.abort();

    const msgs = messages.value.get(sessionId) ?? [];
    const filtered = msgs.filter(
      (m) => m.id !== streamState.tempUserMessageId && m.id !== streamState.tempAssistantMessageId,
    );
    messages.value.set(sessionId, filtered);
    triggerRef(messages);

    activeStreams.value.delete(sessionId);

    fetchMessages(sessionId).catch(console.error);

    return true;
  };

  const abortAllStreams = (): void => {
    for (const [sessionId] of activeStreams.value) {
      abortStream(sessionId);
    }
  };

  function $reset(): void {
    abortAllStreams();
    sessions.value = [];
    openedSession.value = null;
    currentSessionId.value = null;
    messages.value = new Map();
    messagesNextCursors.value = new Map();
    activeStreams.value = new Map();
    unsentMessageIds.clear();
    isLoadingSessions.value = false;
    isLoadingMessages.value = false;
    isCreatingSession.value = false;
    sessionsNextCursor.value = undefined;
    sessionsQuery.value = {};
  }

  const handleStreamResponse = async (
    body: ReadableStream<Uint8Array>,
    options: {
      onChunk?: (chunk: string) => void;
      onPart?: (part: ChatMessagePart) => void;
      onStatus?: (status: string) => void;
      onError?: (reason: ChatStreamError) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<void> => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    let eventType: string | null = null;

    const parseStreamLine = (line: string): void => {
      const trimmed = line.trim();
      if (trimmed === "") {
        return;
      }

      if (trimmed.startsWith("event: ")) {
        eventType = trimmed.slice(7);
        return;
      }

      if (trimmed.startsWith("data: ")) {
        const raw = trimmed.slice(6);
        const currentEventType = eventType;
        eventType = null;

        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch (error) {
          console.debug("Failed to parse stream data", { error, line: trimmed });
          return;
        }

        if (currentEventType === ChatStreamEvents.Error) {
          const reasons: string[] = Object.values(ChatStreamErrors);
          options.onError?.(
            typeof value === "string" && reasons.includes(value) ? (value as ChatStreamError) : ChatStreamErrors.Failed,
          );
        } else if (currentEventType === ChatStreamEvents.Status) {
          options.onStatus?.(value as string);
        } else if (currentEventType === ChatStreamEvents.Token) {
          options.onChunk?.(value as string);
        } else if (currentEventType === ChatStreamEvents.Part) {
          options.onPart?.(value as ChatMessagePart);
        }
      }
    };

    try {
      while (!options.signal?.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          parseStreamLine(line);
        }
      }

      if (buffer && !options.signal?.aborted) {
        parseStreamLine(buffer);
      }
    } finally {
      reader.releaseLock();
    }
  };

  return {
    sessions,
    currentSessionId,
    messages,
    activeStreams,
    currentSession,
    currentMessages,
    isLoadingSessions,
    isLoadingMessages,
    isCreatingSession,
    hasMoreSessions,
    fetchSessions,
    searchSessions,
    loadMoreSessions,
    createSession,
    updateSession,
    autoRenameSession,
    deleteSession,
    selectSession,
    fetchMessages,
    loadOlderMessages,
    hasOlderMessages,
    sendMessage,
    retryMessage,
    regenerateMessage,
    deleteMessage,
    editMessage,
    getStream,
    abortStream,
    abortAllStreams,
    $reset,
  };
});
