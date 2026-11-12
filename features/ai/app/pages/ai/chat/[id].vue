<script setup lang="ts">
import { useInfiniteScroll } from "@vueuse/core";
import { navigateTo, useSeoMeta } from "nuxt/app";
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import UButton from "@nuxt/ui/components/Button.vue";
import UChatMessages from "@nuxt/ui/components/ChatMessages.vue";
import UChatPrompt from "@nuxt/ui/components/ChatPrompt.vue";
import UChatPromptSubmit from "@nuxt/ui/components/ChatPromptSubmit.vue";
import UChatTool from "@nuxt/ui/components/ChatTool.vue";
import UDropdownMenu from "@nuxt/ui/components/DropdownMenu.vue";
import UIcon from "@nuxt/ui/components/Icon.vue";
import UProgress from "@nuxt/ui/components/Progress.vue";
import { useOverlay } from "@nuxt/ui/composables/useOverlay";
import { useToast } from "@nuxt/ui/composables/useToast";

import { useAnswerError } from "#layers/ai/app/composables/answer-error";
import { useAgentStore } from "#layers/ai/app/stores/agent";
import { useChatStore } from "#layers/ai/app/stores/chat";
import { copyToClipboard } from "#layers/core/app/utils/clipboard";
import { definePageMeta } from "#layers/core/app/utils/page-meta";
import { sidebarKey } from "#layers/core/app/utils/symbols";
import { AiPermissions } from "#layers/ai/shared/rbac";

import ChartFrame from "#layers/ai/app/components/chat/ChartFrame.vue";
import LazyDeleteModal from "#layers/ai/app/components/chat/DeleteModal.vue";
import MessageContent from "#layers/ai/app/components/chat/MessageContent.vue";
import LazyRenameModal from "#layers/ai/app/components/chat/RenameModal.vue";
import AgentSelect from "#layers/ai/app/components/ui/AgentSelect.vue";

const i18n = useI18n();
const route = useRoute("ai-chat-id");
const agentStore = useAgentStore();
const chatStore = useChatStore();
const { describeAnswerError } = useAnswerError();
const toast = useToast();
const overlay = useOverlay();

const sidebar = inject(sidebarKey);

const chatDeleteModal = overlay.create(LazyDeleteModal);
const chatRenameModal = overlay.create(LazyRenameModal);

const input = ref<string>("");
const promptRef = ref<InstanceType<typeof UChatPrompt>>();
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
    if (currentSession.value?.agentId === agentId) return;

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

interface MessagePart {
  type: string;
  text?: string;
}

const title = computed(() => {
  return chatStore.currentSession?.title ?? i18n.t("ai.pages.chat.untitled");
});

const uiMessages = computed(() => {
  return chatStore.currentMessages.map((msg) => ({
    id: msg.id,
    // Map "app" and "tool" messages to "system" for UI display (Nuxt UI doesn't support custom roles)
    role: msg.role === "app" || msg.role === "tool" ? "system" : msg.role,
    parts: [{ type: "text" as const, text: msg.content }],
    createdAt: msg.createdAt,
  }));
});

const messageParts = computed(() => {
  return new Map(chatStore.currentMessages.map((msg) => [msg.id, msg.parts]));
});

const userProps = computed(() => ({
  avatar: { icon: "i-lucide-user" },
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

const actionItems = computed(() => [
  {
    label: i18n.t("ai.pages.chat.actions.rename"),
    icon: "i-lucide-pencil",
    onSelect: handleRenameSession,
  },
  {
    label: i18n.t("ai.pages.chat.actions.delete"),
    icon: "i-lucide-trash-2",
    onSelect: handleDeleteSession,
  },
]);

const loadSession = async () => {
  showsLastMessages.value = false;
  try {
    await chatStore.selectSession(sessionId.value);
    await nextTick();
    messagesContainer.value?.scrollTo({ top: messagesContainer.value.scrollHeight });
    showsLastMessages.value = true;
  } catch (error) {
    console.error("Failed to load chat session", error);
    toast.add({
      color: "error",
      title: i18n.t("ai.pages.chat.actions.fetchChat.error.title"),
      description: i18n.t("ai.pages.chat.actions.fetchChat.error.description"),
    });
    await navigateTo("/ai");
  }
};

const handleStopGeneration = () => {
  chatStore.abortStream(sessionId.value);
};

const handleSubmit = async (e: Event) => {
  e.preventDefault();
  if (!input.value.trim() || chatStatus.value === "streaming") return;

  const userMessage = input.value;
  input.value = "";

  try {
    await chatStore.sendMessage(sessionId.value, userMessage);
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
  const instance = chatRenameModal.open({ id: sessionId.value });
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
  const instance = chatDeleteModal.open({ id: sessionId.value });
  const result = (await instance.result) as { deleted: boolean; error: Error | null };
  if (result.deleted) {
    toast.add({
      color: "success",
      title: i18n.t("ai.pages.welcome.actions.deleteChat.success.title"),
      description: i18n.t("ai.pages.welcome.actions.deleteChat.success.description"),
    });
    await navigateTo("/ai");
  } else if (result.error) {
    toast.add({
      color: "error",
      title: i18n.t("ai.pages.welcome.actions.deleteChat.error.title"),
      description: i18n.t("ai.pages.welcome.actions.deleteChat.error.description"),
    });
  }
};

const handleCopyMessage = async (_e: MouseEvent, message: { id: string; parts: MessagePart[] }) => {
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

const handleEditMessage = async (_e: MouseEvent, message: { id: string; parts: MessagePart[] }) => {
  try {
    const messageContent = await chatStore.editMessage(sessionId.value, message.id);
    input.value = messageContent;
    await nextTick();
    const promptElement = promptRef.value?.$el as HTMLElement | undefined;
    const textarea = promptElement?.querySelector("textarea");
    textarea?.focus();
  } catch (error) {
    console.error("Failed to edit message", error);
    toast.add({
      color: "error",
      title: i18n.t("ai.pages.chat.actions.editMessage.error.title"),
      description: describeAnswerError(error, i18n.t("ai.pages.chat.actions.editMessage.error.description")),
    });
  }
};

const handleRetryMessage = async (_e: MouseEvent, message: { id: string; parts: MessagePart[] }) => {
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

const handleRegenerateMessage = async (_e: MouseEvent, message: { id: string; parts: MessagePart[] }) => {
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

const handleDeleteMessage = async (_e: MouseEvent, message: { id: string; parts: MessagePart[] }) => {
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

const handleBeforeUnload = () => {
  chatStore.abortStream(sessionId.value);
};

useInfiniteScroll(
  messagesContainer,
  async () => {
    const container = messagesContainer.value;
    if (!container) return;

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
    canLoadMore: () =>
      showsLastMessages.value && chatStore.hasOlderMessages(sessionId.value) && !chatStore.isLoadingMessages,
  },
);

onMounted(async () => {
  await loadSession();
  window.addEventListener("beforeunload", handleBeforeUnload);
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
});

watch(
  () => route.params.id,
  async (newId, oldId) => {
    if (newId && newId !== oldId) {
      await loadSession();
    }
  },
);

useSeoMeta({
  title,
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
          <template
            v-if="chatStatus === 'streaming' && message.role === 'assistant' && !messageParts.get(message.id)?.length"
          >
            <div class="flex items-center gap-2 py-3 text-muted">
              <div class="flex gap-1">
                <div class="h-2 w-2 animate-bounce rounded-full bg-current [animation-delay:-0.3s]"></div>
                <div class="h-2 w-2 animate-bounce rounded-full bg-current [animation-delay:-0.15s]"></div>
                <div class="h-2 w-2 animate-bounce rounded-full bg-current"></div>
              </div>
            </div>
          </template>
          <div v-else class="flex flex-col gap-2">
            <template v-for="(part, index) in messageParts.get(message.id)" :key="index">
              <MessageContent v-if="part.type === 'text'" :text="part.text" />
              <UChatTool v-else-if="part.type === 'tool'" :text="part.name" icon="i-lucide-wrench">
                <MessageContent :text="part.description" />
              </UChatTool>
              <ChartFrame v-else :option="part.option" />
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
          class="absolute top-0 right-0 left-0"
        />
        <div class="flex items-center gap-2 px-0 py-3 text-sm text-muted">
          <UIcon name="i-lucide-wrench" class="size-4 text-primary" />
          <span>{{ toolStatus }}</span>
        </div>
      </div>
      <UChatPrompt
        ref="promptRef"
        v-model="input"
        variant="subtle"
        autocomplete="off"
        :ui="{ footer: 'empty:hidden' }"
        :disabled="!agentStore.hasAgents"
        class="sticky bottom-0 z-10 rounded-b-none [view-transition-name:chat-prompt]"
        @submit="handleSubmit"
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
