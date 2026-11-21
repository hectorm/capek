<script setup lang="ts">
import { useInfiniteScroll, useMounted } from "@vueuse/core";
import { navigateTo } from "nuxt/app";
import { computed, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import type { ScrollAreaVirtualizeOptions } from "@nuxt/ui/components/ScrollArea.vue";
import UButton from "@nuxt/ui/components/Button.vue";
import UScrollArea from "@nuxt/ui/components/ScrollArea.vue";
import UTooltip from "@nuxt/ui/components/Tooltip.vue";
import { useToast } from "@nuxt/ui/composables/useToast";

import { useChatSessionDelete } from "#layers/ai/app/composables/chat-session-delete";
import { useChatUI } from "#layers/ai/app/composables/chat-ui";
import { useAgentStore } from "#layers/ai/app/stores/agent";
import { useChatStore } from "#layers/ai/app/stores/chat";
import { useAppFeatures } from "#layers/core/app/composables/features";

const props = defineProps<{
  collapsed?: boolean;
}>();

const i18n = useI18n();
const confirmDelete = useChatSessionDelete();
const route = useRoute();
const toast = useToast();

const agentStore = useAgentStore();
const chatStore = useChatStore();
const { home } = useAppFeatures();
const { groupedSessions } = useChatUI(computed(() => chatStore.sessions));
const mounted = useMounted();

const sessionsContainer = useTemplateRef<{ $el: HTMLElement }>("sessionsContainer");
const focusedSession = ref<string>();

const showSessions = computed(() => home.value === "/ai" || route.path === "/ai" || route.path.startsWith("/ai/"));

const items = computed(() => {
  return groupedSessions.value.flatMap((group) => {
    const chats = group.items.map((item) => ({ ...item, type: "chat" as const }));
    return props.collapsed ? chats : [{ id: group.id, label: group.label, type: "label" as const }, ...chats];
  });
});

const focusedIndex = computed(() => {
  const id = focusedSession.value;
  return id === undefined ? -1 : items.value.findIndex((item) => item.id === id);
});

const virtualize: ScrollAreaVirtualizeOptions = {
  estimateSize: 32,
  getItemKey: (index) => items.value[index]?.id ?? index,
  rangeExtractor: ({ startIndex, endIndex, overscan, count }) => {
    const indices = new Set<number>();
    for (let index = Math.max(0, startIndex - overscan); index <= Math.min(count - 1, endIndex + overscan); index++) {
      indices.add(index);
    }
    // Keep the focused chat and its neighbors mounted across scrolls and date group boundaries
    if (focusedIndex.value >= 0) {
      for (
        let index = Math.max(0, focusedIndex.value - 2);
        index <= Math.min(count - 1, focusedIndex.value + 2);
        index++
      ) {
        indices.add(index);
      }
    }
    return [...indices].sort((a, b) => a - b);
  },
};

const onFocusChange = (event: FocusEvent): void => {
  const target = event.type === "focusin" ? event.target : event.relatedTarget;
  focusedSession.value =
    target instanceof Element ? target.closest<HTMLElement>("[data-session-id]")?.dataset.sessionId : undefined;
};

const onNewChat = async (): Promise<void> => {
  try {
    const session = await chatStore.createSession();
    await navigateTo(`/ai/chat/${session.id}`);
  } catch (error) {
    console.error("Failed to create chat session", error);
    toast.add({
      color: "error",
      title: i18n.t("ai.pages.welcome.actions.createChat.error.title"),
      description: i18n.t("ai.pages.welcome.actions.createChat.error.description"),
    });
  }
};

const onDeleteChat = async (session: { id: string; title: string }): Promise<void> => {
  if ((await confirmDelete(session)) && route.name === "ai-chat-id" && route.params.id === session.id) {
    void navigateTo("/ai");
  }
};

watch(
  () => mounted.value && showSessions.value,
  async (visible) => {
    if (!visible) {
      return;
    }

    try {
      await chatStore.fetchSessions();
    } catch (error) {
      console.error("Failed to load chat sessions", error);
      if (showSessions.value) {
        toast.add({
          color: "error",
          title: i18n.t("ai.pages.welcome.actions.fetchChats.error.title"),
          description: i18n.t("ai.pages.welcome.actions.fetchChats.error.description"),
        });
      }
    }
  },
);

useInfiniteScroll(
  () => sessionsContainer.value?.$el,
  async () => {
    try {
      await chatStore.loadMoreSessions();
    } catch (error) {
      console.error("Failed to load more chat sessions", error);
    }
  },
  {
    distance: 200,
    canLoadMore: () => showSessions.value && chatStore.hasMoreSessions && !chatStore.isLoadingSessions,
  },
);
</script>

<template>
  <div v-show="showSessions" class="flex min-h-0 flex-1 flex-col">
    <div v-if="!collapsed" class="border-b border-default p-4">
      <UButton
        block
        autocomplete="off"
        class="text-nowrap"
        icon="i-lucide-plus"
        :disabled="!agentStore.hasAgents"
        :loading="chatStore.isCreatingSession"
        @click="onNewChat"
      >
        {{ $t("ai.pages.welcome.newChat") }}
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
        :aria-label="$t('ai.pages.welcome.newChat')"
        @click="onNewChat"
      />
    </div>
    <UScrollArea
      ref="sessionsContainer"
      as="nav"
      :items="items"
      :virtualize="virtualize"
      class="min-h-0 flex-1 p-2 [overflow-anchor:none]"
      :aria-label="$t('ai.components.chat.sessionsSidebar.history')"
      @focusin="onFocusChange"
      @focusout="onFocusChange"
    >
      <template #default="{ item }">
        <div v-if="item.type === 'label'" class="flex h-8 items-center px-2.5 text-xs font-semibold text-highlighted">
          {{ item.label }}
        </div>
        <div v-else :data-session-id="item.id" class="group/chat relative">
          <UTooltip :text="item.label" :delay-duration="300" :content="{ side: 'right', sideOffset: 24 }">
            <UButton
              block
              exact
              no-prefetch
              :to="item.to"
              color="neutral"
              variant="ghost"
              class="h-8 min-w-0"
              :aria-label="item.label"
              active-class="bg-elevated text-primary"
              inactive-class="text-muted hover:text-highlighted"
              :class="collapsed ? 'justify-center' : 'justify-start pe-8'"
            >
              <span class="truncate" :class="{ 'first-letter:uppercase': collapsed }">
                {{ collapsed ? item.label.substring(0, 3).toLowerCase() : item.label }}
              </span>
            </UButton>
          </UTooltip>
          <UButton
            v-if="!collapsed"
            size="xs"
            tabindex="-1"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            :aria-label="$t('ai.components.chat.sessionsSidebar.deleteChat')"
            class="absolute inset-e-1 top-1/2 -translate-y-1/2 p-0.5 text-muted opacity-0 transition-opacity group-hover/chat:opacity-100 hover:bg-accented/50 hover:text-primary focus-visible:bg-accented/50 focus-visible:opacity-100"
            @click="onDeleteChat({ id: item.id, title: item.label })"
          />
        </div>
      </template>
    </UScrollArea>
  </div>
</template>
