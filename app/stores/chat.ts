import { useNuxtApp } from "nuxt/app";
import { defineStore } from "pinia";
import { computed, ref, shallowRef, triggerRef } from "vue";

import type { ChatMessage, ChatSession } from "~~/shared/schema";
import { OpenAIStreamChunkSchema } from "~~/shared/openai";

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

export const useChatStore = defineStore("chat", () => {
  const { $trpc } = useNuxtApp();

  const sessions = ref<ChatSession[]>([]);
  const currentSessionId = ref<string | null>(null);
  const messages = shallowRef<Map<string, ChatMessage[]>>(new Map());
  const activeStreams = ref<Map<string, StreamState>>(new Map());
  const isLoadingSessions = ref<boolean>(false);
  const isLoadingMessages = ref<boolean>(false);
  const isCreatingSession = ref<boolean>(false);
  const sessionsNextCursor = ref<string | undefined>(undefined);
  const sessionsQuery = ref<SearchQuery>({});

  const currentSession = computed(() => {
    if (!currentSessionId.value) return null;
    return sessions.value.find((s) => s.id === currentSessionId.value) ?? null;
  });

  const currentMessages = computed(() => {
    if (!currentSessionId.value) return [];
    return messages.value.get(currentSessionId.value) ?? [];
  });

  const fetchSessions = async (): Promise<void> => {
    isLoadingSessions.value = true;

    try {
      const result = await $trpc.chatSession.search.query({});
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
      const result = await $trpc.chatSession.search.query(query);
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
      const result = await $trpc.chatSession.search.query({
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
      const session = await $trpc.chatSession.create.mutate({ title, agentId });
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
    if (!sessions.value.find((s) => s.id === sessionId)) {
      throw new Error("Session not found");
    }

    try {
      const session = await $trpc.chatSession.update.mutate({
        id: sessionId,
        title: data.title,
        agentId: data.agentId ?? undefined,
      });
      sessions.value = sessions.value.map((s) => (s.id === sessionId ? session : s));
    } catch (error) {
      throw new Error("Failed to update chat session", { cause: error });
    }
  };

  const autoRenameSession = async (sessionId: string): Promise<void> => {
    if (!sessions.value.find((s) => s.id === sessionId)) {
      throw new Error("Session not found");
    }

    try {
      const session = await $trpc.chatSession.autoRename.mutate({ id: sessionId });
      sessions.value = sessions.value.map((s) => (s.id === sessionId ? session : s));
    } catch (error) {
      throw new Error("Failed to auto-rename chat session", { cause: error });
    }
  };

  const deleteSession = async (sessionId: string): Promise<void> => {
    abortStream(sessionId);

    try {
      await $trpc.chatSession.delete.mutate({ id: sessionId });
      sessions.value = sessions.value.filter((s) => s.id !== sessionId);
      messages.value.delete(sessionId);
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
    if (!activeStreams.value.has(sessionId)) {
      await fetchMessages(sessionId);
    }
  };

  const fetchMessages = async (sessionId: string): Promise<void> => {
    isLoadingMessages.value = true;

    try {
      messages.value.set(sessionId, await $trpc.chatMessage.list.query({ sessionId }));
      triggerRef(messages);
    } catch (error) {
      throw new Error("Failed to fetch messages", { cause: error });
    } finally {
      isLoadingMessages.value = false;
    }
  };

  const sendMessage = async (sessionId: string, content: string): Promise<void> => {
    const controller = new AbortController();
    const tempUserMessageId = crypto.randomUUID();
    const tempAssistantMessageId = crypto.randomUUID();

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
      createdAt: now,
      updatedAt: now,
    };

    const tempAssistantMessage: ChatMessage = {
      id: tempAssistantMessageId,
      sessionId,
      role: "assistant",
      content: "",
      createdAt: now,
      updatedAt: now,
    };

    const currentMsgs = messages.value.get(sessionId) ?? [];
    messages.value.set(sessionId, [...currentMsgs, tempUserMessage, tempAssistantMessage]);
    triggerRef(messages);

    const shouldAutoRename = currentSession.value?.title === "" && !currentMsgs.some((m) => m.role === "user");

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
      const response = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: content }),
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
            const state = activeStreams.value.get(sessionId);
            if (state) {
              state.status = status;
            }
          },
          onChunk: (chunk) => {
            const msgs = messages.value.get(sessionId);
            if (!msgs) return;

            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg?.id === tempAssistantMessageId) {
              const updatedMsg = { ...lastMsg, content: lastMsg.content + chunk };
              messages.value.set(sessionId, [...msgs.slice(0, -1), updatedMsg]);
              triggerRef(messages);
            }
          },
          onError: (message) => {
            throw new Error(message);
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
          createdAt: preservedNow,
          updatedAt: preservedNow,
        };
        messages.value.set(sessionId, [...updatedMsgs, preservedUserMessage]);
        triggerRef(messages);
      }

      throw new Error("Failed to send message", { cause: error });
    } finally {
      activeStreams.value.delete(sessionId);
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
      await $trpc.chatMessage.delete.mutate({ id: messageId, sessionId });
      messages.value.set(sessionId, msgs.slice(0, messageIndex));
      triggerRef(messages);
      await sendMessage(sessionId, userMessageContent);
    } catch (error) {
      await fetchMessages(sessionId);
      throw new Error("Failed to retry message", { cause: error });
    }
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
      await $trpc.chatMessage.delete.mutate({ id: messageId, sessionId });
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
      await $trpc.chatMessage.delete.mutate({ id: messageId, sessionId });
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
    currentSessionId.value = null;
    messages.value = new Map();
    activeStreams.value = new Map();
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
      onStatus?: (status: string) => void;
      onError?: (message: string) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<void> => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    let eventType: string | null = null;

    const parseStreamLine = (line: string): void => {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed === "data: [DONE]") return;

      // Handle SSE event
      if (trimmed.startsWith("event: ")) {
        eventType = trimmed.slice(7);
        return;
      }

      // Handle SSE comments (status messages)
      if (trimmed.startsWith(":")) {
        const status = trimmed.slice(1).trim();
        options.onStatus?.(status);
        return;
      }

      // Handle SSE data
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6);
        const currentEventType = eventType;
        eventType = null;

        // Handle error events
        if (currentEventType === "error") {
          options.onError?.(data || "Agent execution failed");
          return;
        }

        // Handle OpenAI stream chunks
        try {
          const rawData: unknown = JSON.parse(data);
          const chunk = OpenAIStreamChunkSchema.safeParse(rawData);
          if (chunk.success && chunk.data.choices[0]) {
            const delta = chunk.data.choices[0].delta;
            if (delta.content) {
              options.onChunk?.(delta.content);
            }
          }
        } catch (error) {
          console.debug("Failed to parse stream chunk", { error, line: trimmed });
        }
      }
    };

    try {
      while (!options.signal?.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

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
