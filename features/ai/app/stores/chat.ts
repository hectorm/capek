import type { ComputedRef, Ref, ShallowRef } from "vue";
import { useNuxtApp } from "nuxt/app";
import { defineStore } from "pinia";
import { computed, ref, shallowReactive, shallowRef, triggerRef } from "vue";

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

export class ChatAnswerError extends Error {
  public readonly reason: ChatStreamError;

  public constructor(reason: ChatStreamError) {
    super(`The answer failed: ${reason}`);
    this.name = "ChatAnswerError";
    this.reason = reason;
  }
}

export interface ChatStore {
  sessions: Ref<ChatSession[]>;
  currentSessionId: Ref<string | null>;
  messages: ShallowRef<Map<string, ChatMessage[]>>;
  activeStreams: Ref<Map<string, StreamState>>;
  currentSession: ComputedRef<ChatSession | null>;
  currentMessages: ComputedRef<ChatMessage[]>;
  isLoadingSessions: Ref<boolean>;
  isLoadingMessages: ComputedRef<boolean>;
  isCreatingSession: Ref<boolean>;
  hasMoreSessions: ComputedRef<boolean>;
  fetchSessions: () => Promise<void>;
  loadMoreSessions: () => Promise<void>;
  createSession: (title?: string, agentId?: string) => Promise<ChatSession>;
  updateSession: (sessionId: string, data: { title?: string; agentId?: string | null }) => Promise<void>;
  generateSessionTitle: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  selectSession: (sessionId: string, signal?: AbortSignal) => Promise<void>;
  fetchMessages: (sessionId: string, signal?: AbortSignal) => Promise<void>;
  loadOlderMessages: (sessionId: string) => Promise<void>;
  hasOlderMessages: (sessionId: string) => boolean;
  sendMessage: (sessionId: string, content: string, replaceMessageId?: string) => Promise<boolean>;
  retryMessage: (sessionId: string, messageId: string) => Promise<void>;
  regenerateMessage: (sessionId: string, messageId: string) => Promise<void>;
  deleteMessage: (sessionId: string, messageId: string) => Promise<void>;
  getStream: (sessionId: string) => StreamState | undefined;
  abortStream: (sessionId: string) => boolean;
}

export const useChatStore = defineStore("ai.chat", (): ChatStore => {
  const { $trpc } = useNuxtApp();

  const sessions = ref<ChatSession[]>([]);
  const openedSession = ref<ChatSession | null>(null);
  const currentSessionId = ref<string | null>(null);
  const messages = shallowRef<Map<string, ChatMessage[]>>(new Map());
  const messagesNextCursors = ref<Map<string, MessagesCursor>>(new Map());
  const activeStreams = ref<Map<string, StreamState>>(new Map());
  const unsentMessageIds = new Set<string>();
  const isLoadingSessions = ref<boolean>(false);
  const latestMessageLoads = shallowReactive(new Map<string, symbol>());
  const isLoadingMessages = computed(() => latestMessageLoads.size > 0);
  const isCreatingSession = ref<boolean>(false);
  const sessionsNextCursor = ref<RouterOutputs["ai"]["chatSession"]["search"]["nextCursor"]>(undefined);
  let sessionsLoaded = false;

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
    if (sessionsLoaded || isLoadingSessions.value) {
      return;
    }

    isLoadingSessions.value = true;

    try {
      const result = await $trpc.ai.chatSession.search.query({});
      sessions.value = result.sessions;
      sessionsNextCursor.value = result.nextCursor;
      sessionsLoaded = true;
    } catch (error) {
      throw new Error("Failed to fetch chat sessions", { cause: error });
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
      const result = await $trpc.ai.chatSession.search.query({ cursor: sessionsNextCursor.value });
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

      // New sessions may already contain an agent greeting
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

  const generateSessionTitle = async (sessionId: string): Promise<void> => {
    if (!findSession(sessionId)) {
      throw new Error("Session not found");
    }

    try {
      const session = await $trpc.ai.chatSession.generateTitle.mutate({ id: sessionId });
      replaceSession(session);
    } catch (error) {
      throw new Error("Failed to generate chat session title", { cause: error });
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
      latestMessageLoads.delete(sessionId);
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

  const selectSession = async (sessionId: string, signal?: AbortSignal): Promise<void> => {
    currentSessionId.value = sessionId;
    if (!sessions.value.some((s) => s.id === sessionId)) {
      const session = await $trpc.ai.chatSession.read.query({ id: sessionId }, { signal });
      if (signal?.aborted || currentSessionId.value !== sessionId) {
        return;
      }
      openedSession.value = session;
    }
    if (!activeStreams.value.has(sessionId)) {
      await fetchMessages(sessionId, signal);
    }
  };

  const loadMessagePage = async (sessionId: string, cursor?: MessagesCursor, signal?: AbortSignal): Promise<void> => {
    const load = Symbol();
    latestMessageLoads.set(sessionId, load);
    try {
      const result = await $trpc.ai.chatMessage.list.query({ sessionId, cursor }, { signal });
      if (signal?.aborted || latestMessageLoads.get(sessionId) !== load) {
        return;
      }
      const sessionMessages = messages.value.get(sessionId) ?? [];
      if (cursor) {
        messages.value.set(sessionId, [...result.messages, ...sessionMessages]);
        messagesNextCursors.value.set(sessionId, result.nextCursor);
      } else {
        const index = sessionMessages.findIndex((m) => m.id === result.messages[0]?.id);
        if (index > 0) {
          messages.value.set(sessionId, [...sessionMessages.slice(0, index), ...result.messages]);
        } else {
          messages.value.set(sessionId, result.messages);
          messagesNextCursors.value.set(sessionId, result.nextCursor);
        }
      }
      triggerRef(messages);
    } catch (error) {
      if (!signal?.aborted && latestMessageLoads.get(sessionId) === load) {
        throw new Error("Failed to fetch messages", { cause: error });
      }
    } finally {
      if (latestMessageLoads.get(sessionId) === load) {
        latestMessageLoads.delete(sessionId);
      }
    }
  };

  const fetchMessages = (sessionId: string, signal?: AbortSignal): Promise<void> => {
    return loadMessagePage(sessionId, undefined, signal);
  };

  const loadOlderMessages = async (sessionId: string): Promise<void> => {
    const cursor = messagesNextCursors.value.get(sessionId);
    if (cursor && !isLoadingMessages.value) {
      await loadMessagePage(sessionId, cursor);
    }
  };

  const hasOlderMessages = (sessionId: string): boolean => messagesNextCursors.value.get(sessionId) != null;

  const replaceMessagesFrom = (
    sessionId: string,
    messageId: string | undefined,
    ...replacement: ChatMessage[]
  ): void => {
    const sessionMessages = messages.value.get(sessionId) ?? [];
    const index = messageId ? sessionMessages.findIndex((m) => m.id === messageId) : sessionMessages.length;
    if (index >= 0) {
      messages.value.set(sessionId, [...sessionMessages.slice(0, index), ...replacement]);
      triggerRef(messages);
    }
  };

  const sendMessage = async (sessionId: string, content: string, replaceMessageId?: string): Promise<boolean> => {
    const previousMessages = messages.value.get(sessionId) ?? [];
    if (replaceMessageId && !previousMessages.some((m) => m.id === replaceMessageId && m.role === "user")) {
      throw new Error("Message to replace was not found");
    }
    const replacingUnsent = replaceMessageId !== undefined && unsentMessageIds.has(replaceMessageId);
    const firstUserMessage = previousMessages.find((m) => m.role === "user");
    const shouldGenerateTitle =
      currentSession.value?.title === "" && (!firstUserMessage || firstUserMessage.id === replaceMessageId);
    latestMessageLoads.delete(sessionId);
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

    if (!replaceMessageId) {
      replaceMessagesFrom(sessionId, undefined, tempUserMessage, tempAssistantMessage);
    }

    let accepted = false;
    let textEnded = false;

    const onStreamComplete = (): void => {
      const active = activeStreams.value.get(sessionId);
      if (active && active.controller !== controller) {
        return;
      }
      if (replacingUnsent && !accepted) {
        return;
      }
      fetchMessages(sessionId).catch(console.error);
      const session = findSession(sessionId);
      if (session) {
        sessions.value = [{ ...session, updatedAt: new Date() }, ...sessions.value.filter((s) => s.id !== sessionId)];
      }
      if (shouldGenerateTitle) {
        generateSessionTitle(sessionId).catch((error: unknown) => {
          console.warn("Failed to generate chat session title", error);
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
          replaceMessageId: replacingUnsent ? undefined : replaceMessageId,
          userMessageId: tempUserMessageId,
          assistantMessageId: tempAssistantMessageId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to send message: ${errorText}`);
      }

      accepted = true;
      if (replaceMessageId && !controller.signal.aborted) {
        unsentMessageIds.delete(replaceMessageId);
        replaceMessagesFrom(sessionId, replaceMessageId, tempUserMessage, tempAssistantMessage);
      }

      if (response.headers.get("Content-Type")?.includes("text/event-stream") && response.body) {
        await handleStreamResponse(response.body, {
          signal: controller.signal,
          onStatus: (status) => {
            textEnded = true;
            const state = activeStreams.value.get(sessionId);
            if (state?.controller === controller) {
              state.status = status;
            }
          },
          onChunk: (chunk) => {
            const sessionMessages = messages.value.get(sessionId);
            if (!sessionMessages) {
              return;
            }

            const lastMessage = sessionMessages[sessionMessages.length - 1];
            if (lastMessage?.id === tempAssistantMessageId) {
              const lastPart = lastMessage.parts.at(-1);
              const parts: ChatMessagePart[] =
                lastPart?.type === "text" && !textEnded
                  ? [...lastMessage.parts.slice(0, -1), { type: "text", text: lastPart.text + chunk }]
                  : [...lastMessage.parts, { type: "text", text: chunk }];
              textEnded = false;
              const updatedMessage = { ...lastMessage, content: lastMessage.content + chunk, parts };
              messages.value.set(sessionId, [...sessionMessages.slice(0, -1), updatedMessage]);
              triggerRef(messages);
            }
          },
          onPart: (part) => {
            const sessionMessages = messages.value.get(sessionId);
            if (!sessionMessages) {
              return;
            }

            const lastMessage = sessionMessages[sessionMessages.length - 1];
            if (lastMessage?.id === tempAssistantMessageId) {
              const updatedMessage = { ...lastMessage, parts: [...lastMessage.parts, part] };
              messages.value.set(sessionId, [...sessionMessages.slice(0, -1), updatedMessage]);
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
      return accepted;
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        onStreamComplete();
        return accepted;
      }

      if (replaceMessageId && !accepted) {
        // The server may have saved the edit before the connection failed
        if (!replacingUnsent) {
          await fetchMessages(sessionId).catch(console.error);
        }
        throw new Error("Failed to replace message", { cause: error });
      }

      await fetchMessages(sessionId).catch(() => {
        if (activeStreams.value.get(sessionId)?.controller === controller) {
          const sessionMessages = messages.value.get(sessionId) ?? [];
          messages.value.set(
            sessionId,
            sessionMessages.filter((m) => m.id !== tempAssistantMessageId && (accepted || m.id !== tempUserMessageId)),
          );
          triggerRef(messages);
        }
      });
      if (activeStreams.value.get(sessionId)?.controller !== controller) {
        return accepted;
      }

      const updatedMessages = messages.value.get(sessionId) ?? [];
      if (!updatedMessages.some((m) => m.id === tempUserMessageId)) {
        messages.value.set(sessionId, [...updatedMessages, tempUserMessage]);
        triggerRef(messages);
        if (!accepted) {
          unsentMessageIds.add(tempUserMessageId);
        }
      }

      throw new Error("Failed to send message", { cause: error });
    } finally {
      if (activeStreams.value.get(sessionId)?.controller === controller) {
        activeStreams.value.delete(sessionId);
      }
    }
  };

  const deleteMessagesFrom = async (sessionId: string, messageId: string): Promise<void> => {
    if (!unsentMessageIds.delete(messageId)) {
      await $trpc.ai.chatMessage.delete.mutate({ id: messageId, sessionId });
    }
  };

  const retryMessage = async (sessionId: string, messageId: string): Promise<void> => {
    const sessionMessages = messages.value.get(sessionId) ?? [];
    const message = sessionMessages.find((m) => m.id === messageId);
    if (!message) {
      throw new Error("Message not found");
    }
    await sendMessage(sessionId, message.content, messageId);
  };

  const regenerateMessage = async (sessionId: string, messageId: string): Promise<void> => {
    const sessionMessages = messages.value.get(sessionId) ?? [];
    const messageIndex = sessionMessages.findLastIndex((m) => m.id === messageId);

    if (messageIndex === -1) {
      throw new Error("Message not found");
    }

    const previousUserMessage = sessionMessages.slice(0, messageIndex).findLast((m) => m.role === "user");
    if (!previousUserMessage) {
      // An agent greeting has no user message to retry
      return;
    }

    await retryMessage(sessionId, previousUserMessage.id);
  };

  const deleteMessage = async (sessionId: string, messageId: string): Promise<void> => {
    const sessionMessages = messages.value.get(sessionId) ?? [];
    if (!sessionMessages.some((m) => m.id === messageId)) {
      throw new Error("Message not found");
    }

    try {
      await deleteMessagesFrom(sessionId, messageId);
      latestMessageLoads.delete(sessionId);
      replaceMessagesFrom(sessionId, messageId);
    } catch (error) {
      await fetchMessages(sessionId);
      throw new Error("Failed to delete message", { cause: error });
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

    const sessionMessages = messages.value.get(sessionId) ?? [];
    const filtered = sessionMessages.filter(
      (m) => m.id !== streamState.tempUserMessageId && m.id !== streamState.tempAssistantMessageId,
    );
    messages.value.set(sessionId, filtered);
    triggerRef(messages);

    activeStreams.value.delete(sessionId);

    return true;
  };

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
    loadMoreSessions,
    createSession,
    updateSession,
    generateSessionTitle,
    deleteSession,
    selectSession,
    fetchMessages,
    loadOlderMessages,
    hasOlderMessages,
    sendMessage,
    retryMessage,
    regenerateMessage,
    deleteMessage,
    getStream,
    abortStream,
  };
});
