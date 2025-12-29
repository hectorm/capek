<script setup lang="ts">
import { breakpointsTailwind, createReusableTemplate, useBreakpoints, useInfiniteScroll } from "@vueuse/core";
import { navigateTo, useCookie } from "nuxt/app";
import { computed, onMounted, provide, readonly, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import { useOverlay, useToast } from "#imports";

import UButton from "@nuxt/ui/components/Button.vue";
import UNavigationMenu from "@nuxt/ui/components/NavigationMenu.vue";
import USlideover from "@nuxt/ui/components/Slideover.vue";
import UTooltip from "@nuxt/ui/components/Tooltip.vue";

import { useChatUI } from "~/composables/chat-ui";
import { useAgentStore } from "~/stores/agent";
import { useChatStore } from "~/stores/chat";
import { sidebarKey } from "~/utils/symbols";

import LazyDeleteModal from "~/components/chat/DeleteModal.vue";
import AppLogo from "~/components/ui/AppLogo.vue";
import UserMenu from "~/components/ui/UserMenu.vue";

const i18n = useI18n();
const overlay = useOverlay();
const route = useRoute();
const toast = useToast();

const [DefineMenu, ReuseMenu] = createReusableTemplate();

const breakpoints = useBreakpoints(breakpointsTailwind);
const lgAndLarger = breakpoints.greaterOrEqual("lg");

const sidebarOpen = useCookie(`sidebar_open`, {
  default: () => true,
  maxAge: 365 * 24 * 60 * 60,
  sameSite: "lax",
});
const slideoverOpen = ref<boolean>(false);
const open = computed({
  get: () => (lgAndLarger.value ? sidebarOpen.value : slideoverOpen.value),
  set: (value) => ((lgAndLarger.value ? sidebarOpen : slideoverOpen).value = value),
});
const toggle = (): void => {
  open.value = !open.value;
};
provide(sidebarKey, { open: readonly(open), toggle });

const collapsed = computed(() => lgAndLarger.value && !open.value);

const agentStore = useAgentStore();
const chatStore = useChatStore();

const chatDeleteModal = overlay.create(LazyDeleteModal);

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
    await navigateTo(`/chat/${session.id}`);
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
  const instance = chatDeleteModal.open({ id });
  const result = (await instance.result) as { deleted: boolean; error: Error | null };
  if (result.deleted) {
    toast.add({
      color: "success",
      title: i18n.t("pages.welcome.actions.deleteChat.success.title"),
      description: i18n.t("pages.welcome.actions.deleteChat.success.description"),
    });
    if (route.params.id === id) {
      void navigateTo("/");
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

onMounted(async () => {
  try {
    await Promise.all([chatStore.fetchSessions(), agentStore.fetch()]);
  } catch (error) {
    console.error("Failed to fetch initial data", error);
    toast.add({
      color: "error",
      title: i18n.t("pages.welcome.actions.fetchChats.error.title"),
      description: i18n.t("pages.welcome.actions.fetchChats.error.description"),
    });
  }
});

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

watch(
  () => route.path,
  () => {
    if (!lgAndLarger.value && slideoverOpen.value) {
      slideoverOpen.value = false;
    }
  },
);
</script>

<template>
  <div class="flex h-screen flex-row">
    <DefineMenu>
      <div class="flex flex-row gap-2 p-4">
        <UButton
          v-if="!lgAndLarger"
          square
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          :aria-label="$t('layouts.default.sidebar.toggle')"
          @click="() => toggle()"
        />
        <NuxtLink to="/" :aria-label="$t('layouts.default.sidebar.homeLink')">
          <AppLogo class="h-8" :collapsed="collapsed" />
        </NuxtLink>
      </div>
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
      <div class="flex flex-col items-stretch gap-1 border-t border-default px-3.5 py-2">
        <UserMenu class="p-2" :collapsed="collapsed" />
      </div>
    </DefineMenu>
    <template v-if="lgAndLarger">
      <aside
        :style="{ 'scrollbar-width': 'thin' }"
        :aria-label="$t('layouts.default.sidebar.label')"
        :class="[collapsed ? 'max-w-16 min-w-16' : 'max-w-64 min-w-64']"
        class="transition-width hidden flex-col overflow-x-hidden border-r border-default bg-elevated/25 duration-100 lg:flex"
      >
        <div class="flex h-full flex-col" :class="[collapsed ? 'min-w-16' : 'min-w-64']">
          <ReuseMenu />
        </div>
      </aside>
    </template>
    <template v-else>
      <USlideover
        v-model:open="slideoverOpen"
        side="left"
        :title="$t('layouts.default.sidebar.title')"
        :description="$t('layouts.default.sidebar.description')"
      >
        <template #content>
          <ReuseMenu />
        </template>
      </USlideover>
    </template>
    <slot />
  </div>
</template>
