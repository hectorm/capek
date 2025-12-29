<script setup lang="ts">
import { navigateTo } from "nuxt/app";
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";

import { definePageMeta, useToast } from "#imports";

import UButton from "@nuxt/ui/components/Button.vue";
import UChatPrompt from "@nuxt/ui/components/ChatPrompt.vue";
import UChatPromptSubmit from "@nuxt/ui/components/ChatPromptSubmit.vue";

import { useAgentStore } from "~/stores/agent";
import { useChatStore } from "~/stores/chat";
import { useSettingsStore } from "~/stores/settings";
import { sidebarKey } from "~/utils/symbols";

import AgentSelect from "~/components/ui/AgentSelect.vue";

const i18n = useI18n();
const toast = useToast();

const agentStore = useAgentStore();
const chatStore = useChatStore();
const settingsStore = useSettingsStore();

const sidebar = inject(sidebarKey);

const input = ref<string>("");
const selectedAgent = ref<string | null>(null);

const handleCreateChat = async (prompt: string) => {
  if (!prompt.trim() || chatStore.isCreatingSession) return;

  const userInput = prompt.trim();
  input.value = "";

  try {
    const session = await chatStore.createSession(undefined, selectedAgent.value ?? undefined);
    chatStore.sendMessage(session.id, userInput).catch((error: unknown) => {
      console.error("Failed to send initial message", error);
      toast.add({
        color: "error",
        title: i18n.t("pages.chat.actions.sendMessage.error.title"),
        description: i18n.t("pages.chat.actions.sendMessage.error.description"),
      });
    });
    await navigateTo(`/chat/${session.id}`);
  } catch (error) {
    input.value = userInput;
    console.error("Failed to create chat session", error);
    toast.add({
      color: "error",
      title: i18n.t("pages.welcome.actions.createChat.error.title"),
      description: i18n.t("pages.welcome.actions.createChat.error.description"),
    });
  }
};

const handleSubmit = async (e: Event) => {
  e.preventDefault();
  if (!input.value.trim() || chatStore.isCreatingSession) return;
  await handleCreateChat(input.value);
};

const quickChats = computed(() => {
  const prompts = settingsStore.get("welcome.quickChats")?.value ?? [];
  return prompts.map((label) => ({ label, icon: "i-lucide-message-square" }));
});

definePageMeta({
  title: "pages.welcome.title",
  description: "pages.welcome.description",
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
      <h1 class="text-xl font-bold">{{ $t("pages.welcome.title") }}</h1>
    </header>
    <main class="flex flex-1 flex-col justify-center gap-4 px-4 py-8 sm:gap-6">
      <UChatPrompt
        v-model="input"
        variant="subtle"
        autocomplete="off"
        :ui="{ footer: 'empty:hidden' }"
        :disabled="!agentStore.hasAgents"
        class="[view-transition-name:chat-prompt]"
        :placeholder="$t('pages.welcome.prompt.enterMessage')"
        @submit="handleSubmit"
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
          :key="quickChat.label"
          size="sm"
          color="neutral"
          variant="outline"
          autocomplete="off"
          class="rounded-full"
          :icon="quickChat.icon"
          :label="quickChat.label"
          :ui="{ label: 'whitespace-normal text-left' }"
          :disabled="!agentStore.hasAgents || chatStore.isCreatingSession"
          @click="handleCreateChat(quickChat.label)"
        />
      </div>
    </main>
  </div>
</template>
