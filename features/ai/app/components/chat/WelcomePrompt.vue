<script setup lang="ts">
import { navigateTo } from "nuxt/app";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import UButton from "@nuxt/ui/components/Button.vue";
import UChatPrompt from "@nuxt/ui/components/ChatPrompt.vue";
import UChatPromptSubmit from "@nuxt/ui/components/ChatPromptSubmit.vue";
import { useToast } from "@nuxt/ui/composables/useToast";

import { useAnswerError } from "#layers/ai/app/composables/answer-error";
import { useAgentStore } from "#layers/ai/app/stores/agent";
import { useChatStore } from "#layers/ai/app/stores/chat";
import { useSettingsStore } from "#layers/core/app/stores/settings";

import AgentSelect from "#layers/ai/app/components/ui/AgentSelect.vue";

const i18n = useI18n();
const toast = useToast();

const agentStore = useAgentStore();
const chatStore = useChatStore();
const { describeAnswerError } = useAnswerError();
const settingsStore = useSettingsStore();

const input = ref<string>("");
const selectedAgent = ref<string | null>(null);

const quickChats = computed(() => settingsStore.get("ai.quickChats")?.value ?? []);

const handleCreateChat = async (prompt: string) => {
  const userInput = prompt.trim();
  if (!userInput || chatStore.isCreatingSession) {
    return;
  }

  input.value = "";

  try {
    const session = await chatStore.createSession(undefined, selectedAgent.value ?? undefined);
    chatStore.sendMessage(session.id, userInput).catch((error: unknown) => {
      console.error("Failed to send initial message", error);
      toast.add({
        color: "error",
        title: i18n.t("ai.pages.chat.actions.sendMessage.error.title"),
        description: describeAnswerError(error, i18n.t("ai.pages.chat.actions.sendMessage.error.description")),
      });
    });
    await navigateTo(`/ai/chat/${session.id}`);
  } catch (error) {
    input.value = userInput;
    console.error("Failed to create chat session", error);
    toast.add({
      color: "error",
      title: i18n.t("ai.pages.welcome.actions.createChat.error.title"),
      description: i18n.t("ai.pages.welcome.actions.createChat.error.description"),
    });
  }
};
</script>

<template>
  <div class="flex flex-col gap-4 sm:gap-6">
    <UChatPrompt
      v-model="input"
      variant="subtle"
      autocomplete="off"
      :ui="{ footer: 'empty:hidden' }"
      :disabled="!agentStore.hasAgents"
      class="[view-transition-name:chat-prompt]"
      :placeholder="$t('ai.pages.welcome.prompt.enterMessage')"
      @submit.prevent="handleCreateChat(input)"
    >
      <UChatPromptSubmit
        color="neutral"
        autocomplete="off"
        :disabled="!agentStore.hasAgents"
        :status="chatStore.isCreatingSession ? 'submitted' : 'ready'"
      />
      <template #footer>
        <AgentSelect v-model="selectedAgent" auto-select />
      </template>
    </UChatPrompt>
    <div class="flex flex-wrap gap-2">
      <UButton
        v-for="quickChat in quickChats"
        :key="quickChat"
        size="sm"
        color="neutral"
        variant="outline"
        autocomplete="off"
        :label="quickChat"
        class="rounded-full"
        icon="i-lucide-message-square"
        :ui="{ label: 'whitespace-normal text-left' }"
        :disabled="!agentStore.hasAgents || chatStore.isCreatingSession"
        @click="handleCreateChat(quickChat)"
      />
    </div>
  </div>
</template>
