<script setup lang="ts">
import { useInfiniteScroll } from "@vueuse/core";
import { navigateTo } from "nuxt/app";
import { computed, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import { NuxtLink } from "#components";

import UButton from "@nuxt/ui/components/Button.vue";
import UNavigationMenu from "@nuxt/ui/components/NavigationMenu.vue";
import UTooltip from "@nuxt/ui/components/Tooltip.vue";
import { useOverlay } from "@nuxt/ui/composables/useOverlay";
import { useToast } from "@nuxt/ui/composables/useToast";

import { useChatUI } from "#layers/ai/app/composables/chat-ui";
import { useAgentStore } from "#layers/ai/app/stores/agent";
import { useChatStore } from "#layers/ai/app/stores/chat";

import LazyDeleteModal from "#layers/ai/app/components/chat/DeleteModal.vue";

defineProps<{
  collapsed?: boolean;
}>();

const i18n = useI18n();
const overlay = useOverlay();
const route = useRoute();
const toast = useToast();

const agentStore = useAgentStore();
const chatStore = useChatStore();

const { groupedSessions } = useChatUI(computed(() => chatStore.sessions));

const items = computed(() =>
  groupedSessions.value.flatMap((g) => {
    return [
      {
        label: g.label,
        type: "label" as const,
      },
      ...g.items.map((i) => ({
        ...i,
        slot: "chat" as const,
      })),
    ];
  }),
);

const handleNewChat = async (): Promise<void> => {
  try {
    const session = await chatStore.createSession();
    await navigateTo(`/ai/chat/${session.id}`);
  } catch (error) {
    console.error("Failed to create chat session", error);
    toast.add({
      color: "error",
      title: i18n.t("pages.welcome.actions.createChat.error.title"),
      description: i18n.t("pages.welcome.actions.createChat.error.description"),
    });
  }
};

const openChatDeleteModal = async (id: string): Promise<void> => {
  // Created on demand, since the sidebar is remounted whenever the mobile slideover opens
  const instance = overlay.create(LazyDeleteModal, { destroyOnClose: true }).open({ id });
  const result = (await instance.result) as { deleted: boolean; error: Error | null };
  if (result.deleted) {
    toast.add({
      color: "success",
      title: i18n.t("pages.welcome.actions.deleteChat.success.title"),
      description: i18n.t("pages.welcome.actions.deleteChat.success.description"),
    });
    if (route.name === "ai-chat-id" && route.params.id === id) {
      void navigateTo("/ai");
    }
  } else if (result.error) {
    toast.add({
      color: "error",
      title: i18n.t("pages.welcome.actions.deleteChat.error.title"),
      description: i18n.t("pages.welcome.actions.deleteChat.error.description"),
    });
  }
};

const sessionsContainer = useTemplateRef<HTMLElement>("sessionsContainer");

useInfiniteScroll(
  sessionsContainer,
  async () => {
    try {
      await chatStore.loadMoreSessions();
    } catch (error) {
      console.error("Failed to load more chat sessions", error);
    }
  },
  {
    distance: 200,
    canLoadMore: () => chatStore.hasMoreSessions && !chatStore.isLoadingSessions,
  },
);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div v-if="!collapsed" class="border-b border-default p-4">
      <UButton
        block
        autocomplete="off"
        class="text-nowrap"
        icon="i-lucide-plus"
        :disabled="!agentStore.hasAgents"
        :loading="chatStore.isCreatingSession"
        @click="handleNewChat"
      >
        {{ $t("pages.welcome.newChat") }}
      </UButton>
    </div>
    <div v-else class="border-b border-default p-2">
      <UButton
        block
        square
        color="neutral"
        variant="ghost"
        autocomplete="off"
        icon="i-lucide-plus"
        :disabled="!agentStore.hasAgents"
        :loading="chatStore.isCreatingSession"
        :aria-label="$t('pages.welcome.newChat')"
        @click="handleNewChat"
      />
    </div>
    <div ref="sessionsContainer" class="flex-1 overflow-y-auto p-2">
      <UNavigationMenu :items="items" :collapsed="collapsed" orientation="vertical" :ui="{ link: 'overflow-hidden' }">
        <template #chat="{ item }">
          <UTooltip
            :text="item.label"
            :delay-duration="collapsed ? 0 : 500"
            :content="{ side: 'right', sideOffset: 24 }"
          >
            <NuxtLink v-if="!collapsed" :to="item.to" class="group/item flex w-full items-center justify-center">
              <span class="truncate">{{ item.label }}</span>
              <div class="ms-auto -mr-1.25 flex opacity-0 transition-opacity group-hover/item:opacity-100">
                <UButton
                  size="xs"
                  tabindex="-1"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  :aria-label="$t('layouts.default.sidebar.deleteChat')"
                  class="p-0.5 text-muted hover:bg-accented/50 hover:text-primary focus-visible:bg-accented/50"
                  @click.stop.prevent="() => void openChatDeleteModal(item.id)"
                />
              </div>
            </NuxtLink>
            <NuxtLink v-else :to="item.to" class="flex w-full items-center justify-center">
              <span class="truncate first-letter:uppercase" :class="{ 'bg-elevated': route.path === item.to }">
                {{ item.label.substring(0, 3).toLowerCase() }}
              </span>
            </NuxtLink>
          </UTooltip>
        </template>
      </UNavigationMenu>
    </div>
  </div>
</template>
