<script setup lang="ts">
import { useInfiniteScroll } from "@vueuse/core";
import { navigateTo, useSeoMeta } from "nuxt/app";
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onWatcherCleanup,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import type { DropdownMenuItem } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UChatMessages from "@nuxt/ui/components/ChatMessages.vue";
import UChatPrompt from "@nuxt/ui/components/ChatPrompt.vue";
import UChatPromptSubmit from "@nuxt/ui/components/ChatPromptSubmit.vue";
import UChatTool from "@nuxt/ui/components/ChatTool.vue";
import UDropdownMenu from "@nuxt/ui/components/DropdownMenu.vue";
import UIcon from "@nuxt/ui/components/Icon.vue";
import UProgress from "@nuxt/ui/components/Progress.vue";
import UTextarea from "@nuxt/ui/components/Textarea.vue";
import { useOverlay } from "@nuxt/ui/composables/useOverlay";
import { useToast } from "@nuxt/ui/composables/useToast";

import type { ChatMessagePart } from "#layers/ai/shared/chat";
import { useChatSessionDelete } from "#layers/ai/app/composables/chat-session-delete";
import { useAnswerError } from "#layers/ai/app/composables/answer-error";
import { useAgentStore } from "#layers/ai/app/stores/agent";
import { useChatStore } from "#layers/ai/app/stores/chat";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { copyToClipboard } from "#layers/core/app/utils/clipboard";
import { definePageMeta } from "#layers/core/app/utils/page-meta";
import { sidebarKey } from "#layers/core/app/utils/symbols";

import ChartFrame from "#layers/ai/app/components/chat/ChartFrame.vue";
import MessageContent from "#layers/ai/app/components/chat/MessageContent.vue";
import LazyRenameModal from "#layers/ai/app/components/chat/RenameModal.vue";
import TableView from "#layers/ai/app/components/chat/TableView.vue";
import AgentSelect from "#layers/ai/app/components/ui/AgentSelect.vue";

interface MessagePart {
  type: string;
  text?: string;
}

interface MessageEdit {
  id: string;
  original: string;
  text: string;
}

type ToolCallPart = Extract<ChatMessagePart, { type: "tool" }>;

type DisplayedPart = Exclude<ChatMessagePart, { type: "tool" }> | { type: "tools"; calls: ToolCallPart[] };

const i18n = useI18n();
const route = useRoute("ai-chat-id");
const agentStore = useAgentStore();
const chatStore = useChatStore();
const { describeAnswerError } = useAnswerError();
const toast = useToast();
const overlay = useOverlay();
const confirmDelete = useChatSessionDelete();

const sidebar = inject(sidebarKey);

const input = ref<string>("");
const edit = ref<MessageEdit>();
const editField = useTemplateRef<{ textareaRef: HTMLTextAreaElement | null }>("editField");
const messagesContainer = useTemplateRef<HTMLElement>("messagesContainer");
const showsLastMessages = ref<boolean>(false);

const copied = ref<boolean>(false);
const copyTimeoutId = ref<ReturnType<typeof setTimeout>>();

const sessionId = computed(() => route.params.id);
const currentSession = computed(() => chatStore.currentSession);
const streamState = computed(() => chatStore.getStream(sessionId.value));
const chatStatus = computed(() => (streamState.value ? "streaming" : "ready"));
const toolStatus = computed(() => streamState.value?.status ?? "");

const selectedAgent = computed({
  get: () => currentSession.value?.agentId ?? null,
  set: (agentId: string | null) => {
    if (currentSession.value?.agentId === agentId) {
      return;
    }

    void (async () => {
      try {
        await chatStore.updateSession(sessionId.value, { agentId });
      } catch (error) {
        console.error("Failed to update session agent", error);
        toast.add({
          color: "error",
          title: i18n.t("ai.pages.chat.actions.updateSession.error.title"),
          description: i18n.t("ai.pages.chat.actions.updateSession.error.description"),
        });
      }
    })();
  },
});

const title = computed(() => {
  return chatStore.currentSession?.title ?? i18n.t("ai.pages.chat.untitled");
});

const uiMessages = computed(() => {
  return chatStore.currentMessages.map((msg) => ({
    id: msg.id,
    ...(msg.id === edit.value?.id ? { actions: [], ui: { body: "w-full" } } : {}),
    // Nuxt UI displays app and tool messages under its system role
    role: msg.role === "app" || msg.role === "tool" ? "system" : msg.role,
    parts: [{ type: "text" as const, text: msg.content }],
    createdAt: msg.createdAt,
  }));
});

const messageParts = computed(() => {
  return new Map(chatStore.currentMessages.map((msg) => [msg.id, groupToolCalls(msg.parts)]));
});

const userProps = computed(() => ({
  avatar: { icon: "i-lucide-user" },
  ui: { actions: "has-focus-visible:opacity-100" },
  actions:
    chatStatus.value === "ready"
      ? [
          {
            label: i18n.t("ai.pages.chat.actions.edit"),
            icon: "i-lucide-pencil",
            onClick: handleEditMessage,
          },
          {
            label: i18n.t("ai.pages.chat.actions.retry"),
            icon: "i-lucide-rotate-cw",
            onClick: handleRetryMessage,
          },
          {
            label: i18n.t("ai.pages.chat.actions.delete"),
            icon: "i-lucide-trash-2",
            onClick: handleDeleteMessage,
          },
        ]
      : [],
}));

const assistantProps = computed(() => ({
  avatar: { icon: "i-lucide-bot" },
  ui: { actions: "has-focus-visible:opacity-100" },
  actions:
    chatStatus.value === "ready"
      ? [
          {
            label: i18n.t("ai.pages.chat.actions.copy"),
            icon: copied.value ? "i-lucide-copy-check" : "i-lucide-copy",
            onClick: handleCopyMessage,
          },
          {
            label: i18n.t("ai.pages.chat.actions.regenerate"),
            icon: "i-lucide-refresh-cw",
            onClick: handleRegenerateMessage,
          },
          {
            label: i18n.t("ai.pages.chat.actions.delete"),
            icon: "i-lucide-trash-2",
            onClick: handleDeleteMessage,
          },
        ]
      : [],
}));

const actionItems = computed<DropdownMenuItem[]>(() => [
  {
    label: i18n.t("ai.pages.chat.actions.rename"),
    icon: "i-lucide-pencil",
    onSelect: () => void handleRenameSession(),
  },
  {
    label: i18n.t("ai.pages.chat.actions.delete"),
    icon: "i-lucide-trash-2",
    color: "error",
    onSelect: () => void handleDeleteSession(),
  },
]);

useSeoMeta({
  title,
});

const groupToolCalls = (parts: ChatMessagePart[]): DisplayedPart[] => {
  const grouped: DisplayedPart[] = [];
  for (const part of parts) {
    const last = grouped.at(-1);
    if (part.type !== "tool") {
      grouped.push(part);
    } else if (last?.type === "tools") {
      last.calls.push(part);
    } else {
      grouped.push({ type: "tools", calls: [part] });
    }
  }
  return grouped;
};

const toolCallsText = (calls: ToolCallPart[]): string => {
  const names = new Set(calls.map((call) => call.name));
  if (names.size > 1) {
    return i18n.t("ai.pages.chat.toolCalls.tools", { count: calls.length });
  }
  return calls[0]?.name ?? "";
};

const toolCallsSuffix = (calls: ToolCallPart[]): string | undefined => {
  const names = new Set(calls.map((call) => call.name));
  if (calls.length === 1 || names.size > 1) {
    return undefined;
  }
  return i18n.t("ai.pages.chat.toolCalls.calls", { count: calls.length });
};

const loadSession = async (id: string): Promise<void> => {
  edit.value = undefined;
  if (!id) {
    return;
  }
  const controller = new AbortController();
  onWatcherCleanup(() => {
    controller.abort();
  });
  showsLastMessages.value = false;
  try {
    await chatStore.selectSession(id, controller.signal);
    await nextTick();
    if (controller.signal.aborted) {
      return;
    }
    messagesContainer.value?.scrollTo({ top: messagesContainer.value.scrollHeight });
    showsLastMessages.value = true;
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    console.error("Failed to load chat session", error);
    toast.add({
      color: "error",
      title: i18n.t("ai.pages.chat.actions.fetchChat.error.title"),
      description: i18n.t("ai.pages.chat.actions.fetchChat.error.description"),
    });
    await navigateTo("/ai");
  }
};

const handleStopGeneration = (): void => {
  chatStore.abortStream(sessionId.value);
};

const handleSubmit = async (draft?: MessageEdit): Promise<void> => {
  const content = (draft?.text ?? input.value).trim();
  if (!content || content === draft?.original.trim() || chatStatus.value === "streaming") {
    return;
  }
  if (!draft) {
    input.value = "";
  }

  try {
    const accepted = await chatStore.sendMessage(sessionId.value, content, draft?.id);
    if (accepted && draft && edit.value === draft) {
      edit.value = undefined;
    }
  } catch (error) {
    console.error("Failed to send chat message", error);
    toast.add({
      color: "error",
      title: i18n.t("ai.pages.chat.actions.sendMessage.error.title"),
      description: describeAnswerError(error, i18n.t("ai.pages.chat.actions.sendMessage.error.description")),
    });
  }
};

const handleRenameSession = async (): Promise<void> => {
  const instance = overlay.create(LazyRenameModal, { destroyOnClose: true }).open({ id: sessionId.value });
  const result = (await instance.result) as { renamed: boolean; error: Error | null };
  if (result.renamed) {
    toast.add({
      color: "success",
      title: i18n.t("ai.pages.chat.actions.renameSession.success.title"),
      description: i18n.t("ai.pages.chat.actions.renameSession.success.description"),
    });
  } else if (result.error) {
    toast.add({
      color: "error",
      title: i18n.t("ai.pages.chat.actions.renameSession.error.title"),
      description: i18n.t("ai.pages.chat.actions.renameSession.error.description"),
    });
  }
};

const handleDeleteSession = async (): Promise<void> => {
  if (await confirmDelete({ id: sessionId.value, title: chatStore.currentSession?.title ?? "" })) {
    await navigateTo("/ai");
  }
};

const handleCopyMessage = async (_event: MouseEvent, message: { id: string; parts: MessagePart[] }): Promise<void> => {
  const success = await copyToClipboard(() => {
    return message.parts
      .filter((p): p is Required<MessagePart> => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
  });

  if (success) {
    if (copyTimeoutId.value) {
      clearTimeout(copyTimeoutId.value);
    }

    copied.value = true;
    copyTimeoutId.value = setTimeout(() => (copied.value = false), 2000);
  }
};

const handleEditMessage = async (_event: MouseEvent, message: { id: string; parts: MessagePart[] }): Promise<void> => {
  const original = message.parts[0]?.text ?? "";
  edit.value = { id: message.id, original, text: original };
  await nextTick();
  editField.value?.textareaRef?.focus();
};

const handleRetryMessage = async (_event: MouseEvent, message: { id: string; parts: MessagePart[] }): Promise<void> => {
  try {
    await chatStore.retryMessage(sessionId.value, message.id);
  } catch (error) {
    console.error("Failed to retry message", error);
    toast.add({
      color: "error",
      title: i18n.t("ai.pages.chat.actions.retryMessage.error.title"),
      description: describeAnswerError(error, i18n.t("ai.pages.chat.actions.retryMessage.error.description")),
    });
  }
};

const handleRegenerateMessage = async (
  _event: MouseEvent,
  message: { id: string; parts: MessagePart[] },
): Promise<void> => {
  try {
    await chatStore.regenerateMessage(sessionId.value, message.id);
  } catch (error) {
    console.error("Failed to regenerate message", error);
    toast.add({
      color: "error",
      title: i18n.t("ai.pages.chat.actions.regenerateMessage.error.title"),
      description: describeAnswerError(error, i18n.t("ai.pages.chat.actions.regenerateMessage.error.description")),
    });
  }
};

const handleDeleteMessage = async (
  _event: MouseEvent,
  message: { id: string; parts: MessagePart[] },
): Promise<void> => {
  try {
    await chatStore.deleteMessage(sessionId.value, message.id);
  } catch (error) {
    console.error("Failed to delete message", error);
    toast.add({
      color: "error",
      title: i18n.t("ai.pages.chat.actions.deleteMessage.error.title"),
      description: i18n.t("ai.pages.chat.actions.deleteMessage.error.description"),
    });
  }
};

const handleBeforeUnload = (): void => {
  chatStore.abortStream(sessionId.value);
};

useInfiniteScroll(
  messagesContainer,
  async () => {
    const container = messagesContainer.value;
    if (!container) {
      return;
    }

    const offsetFromBottom = container.scrollHeight - container.scrollTop;
    try {
      await chatStore.loadOlderMessages(sessionId.value);
    } catch (error) {
      console.error("Failed to load older messages", error);
      return;
    }
    await nextTick();
    container.scrollTop = container.scrollHeight - offsetFromBottom;
  },
  {
    direction: "top",
    distance: 200,
    canLoadMore: () => {
      return showsLastMessages.value && chatStore.hasOlderMessages(sessionId.value) && !chatStore.isLoadingMessages;
    },
  },
);

onMounted(() => {
  watch(sessionId, loadSession, { immediate: true });
  window.addEventListener("beforeunload", handleBeforeUnload);
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
});

definePageMeta({
  title: "ai.pages.chat.title",
  description: "ai.pages.chat.description",
  permissions: [AiPermissions.ChatReadAll, AiPermissions.ChatReadOwn],
});
</script>

<template>
  <div class="flex w-full flex-col overflow-auto">
    <header class="flex flex-row items-center gap-1.5 border-b border-default p-4">
      <UButton
        square
        color="neutral"
        variant="ghost"
        icon="i-lucide-menu"
        :aria-label="$t('layouts.default.sidebar.toggle')"
        @click="sidebar?.toggle()"
      />
      <h1 class="flex-1 text-xl font-bold">{{ title }}</h1>
      <UDropdownMenu :items="actionItems">
        <UButton
          square
          color="neutral"
          variant="ghost"
          icon="i-lucide-ellipsis-vertical"
          :aria-label="$t('ai.pages.chat.actions.menu')"
        />
      </UDropdownMenu>
    </header>
    <main ref="messagesContainer" class="flex flex-1 flex-col overflow-auto px-4 pt-4">
      <UChatMessages
        :user="userProps"
        class="pb-4 sm:pb-6"
        :status="chatStatus"
        :spacing-offset="160"
        :messages="uiMessages"
        :should-auto-scroll="true"
        :assistant="assistantProps"
        :should-scroll-to-bottom="uiMessages.length > 1"
      >
        <template #content="{ message }">
          <form v-if="edit && message.id === edit.id" class="flex flex-col gap-2" @submit.prevent="handleSubmit(edit)">
            <UTextarea
              ref="editField"
              v-model="edit.text"
              :rows="2"
              autoresize
              :maxrows="12"
              class="w-full"
              :disabled="chatStatus === 'streaming'"
              :aria-label="$t('ai.pages.chat.editMessage')"
            />
            <div class="flex flex-wrap justify-end gap-2">
              <UButton
                size="sm"
                type="button"
                color="neutral"
                variant="ghost"
                :disabled="chatStatus === 'streaming'"
                :label="$t('ai.pages.chat.actions.cancel')"
                @click="edit = undefined"
              />
              <UButton
                size="sm"
                type="submit"
                :label="$t('ai.pages.chat.actions.resend')"
                :disabled="
                  !edit.text.trim() ||
                  edit.text.trim() === edit.original.trim() ||
                  chatStatus === 'streaming' ||
                  !agentStore.hasAgents
                "
              />
            </div>
          </form>
          <template
            v-else-if="
              chatStatus === 'streaming' && message.role === 'assistant' && !messageParts.get(message.id)?.length
            "
          >
            <div class="flex items-center gap-2 py-3 text-muted">
              <div class="flex gap-1">
                <div class="size-2 animate-bounce rounded-full bg-current [animation-delay:-0.3s]"></div>
                <div class="size-2 animate-bounce rounded-full bg-current [animation-delay:-0.15s]"></div>
                <div class="size-2 animate-bounce rounded-full bg-current"></div>
              </div>
            </div>
          </template>
          <div v-else class="flex flex-col gap-2">
            <template v-for="(part, index) in messageParts.get(message.id)" :key="index">
              <MessageContent v-if="part.type === 'text'" :text="part.text" />
              <UChatTool
                v-else-if="part.type === 'tools'"
                icon="i-lucide-wrench"
                :text="toolCallsText(part.calls)"
                :suffix="toolCallsSuffix(part.calls)"
              >
                <MessageContent v-if="part.calls.length === 1" :text="part.calls[0]?.description ?? ''" />
                <div v-else class="flex flex-col gap-2 ps-6">
                  <UChatTool v-for="call in part.calls" :key="call.id" :text="call.name" icon="i-lucide-wrench">
                    <MessageContent :text="call.description" />
                  </UChatTool>
                </div>
              </UChatTool>
              <ChartFrame v-else-if="part.type === 'chart'" :chart="part" />
              <TableView v-else-if="part.type === 'table'" :table="part" />
            </template>
          </div>
        </template>
      </UChatMessages>
      <div v-if="toolStatus" class="relative border-t border-default">
        <UProgress
          size="2xs"
          color="primary"
          :model-value="null"
          animation="carousel"
          class="absolute inset-x-0 top-0"
        />
        <div class="flex items-center gap-2 px-0 py-3 text-sm text-muted">
          <UIcon name="i-lucide-wrench" class="size-4 text-primary" />
          <span>{{ toolStatus }}</span>
        </div>
      </div>
      <UChatPrompt
        v-model="input"
        variant="subtle"
        autocomplete="off"
        :ui="{ footer: 'empty:hidden' }"
        :disabled="!agentStore.hasAgents"
        class="sticky bottom-0 z-10 rounded-b-none [view-transition-name:chat-prompt]"
        @submit.prevent="handleSubmit()"
      >
        <UChatPromptSubmit
          color="neutral"
          autocomplete="off"
          :status="chatStatus"
          :disabled="!agentStore.hasAgents"
          @stop="handleStopGeneration"
        />
        <template #footer>
          <AgentSelect v-if="currentSession" v-model="selectedAgent" auto-select />
        </template>
      </UChatPrompt>
    </main>
  </div>
</template>
