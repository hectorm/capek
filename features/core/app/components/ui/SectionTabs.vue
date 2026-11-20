<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";
import UNavigationMenu from "@nuxt/ui/components/NavigationMenu.vue";

defineProps<{ items: NavigationMenuItem[] }>();
</script>

<template>
  <UNavigationMenu
    highlight
    :items="items"
    orientation="horizontal"
    highlight-color="primary"
    class="border-b border-default px-2 sm:px-4"
    :ui="{
      root: 'shrink-0 overflow-x-auto scrollbar-none',
      list: 'shrink-0 max-sm:items-stretch',
      item: 'max-sm:min-w-min sm:shrink-0',
      link: 'max-sm:h-full max-sm:justify-center max-sm:px-2 max-sm:text-center',
      linkLabel: 'max-sm:whitespace-normal',
      linkLeadingIcon: 'max-sm:hidden',
    }"
  />
</template>
