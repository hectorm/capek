<script setup lang="ts">
import { useEventListener, useFullscreen } from "@vueuse/core";
import { useNuxtApp } from "nuxt/app";
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";

import UButton from "@nuxt/ui/components/Button.vue";
import UDropdownMenu from "@nuxt/ui/components/DropdownMenu.vue";

const props = defineProps<{
  option: Record<string, unknown>;
}>();

const exportFormats = ["png", "svg"] as const;

type ExportFormat = (typeof exportFormats)[number];

const i18n = useI18n();
const { $colorMode: colorMode } = useNuxtApp();

const container = useTemplateRef<HTMLDivElement>("container");
const frame = useTemplateRef<HTMLIFrameElement>("frame");

const { isSupported: canFullscreen, isFullscreen, toggle: toggleFullscreen } = useFullscreen(container);

const visible = ref<boolean>(false);
const failed = ref<boolean>(false);
const formats = ref<ExportFormat[]>([]);

let exportFormat: ExportFormat | undefined;

const exportItems = computed(() => {
  return formats.value.map((format) => ({
    label: i18n.t(`ai.components.chat.chartFrame.export.${format}`),
    onSelect: () => {
      exportImage(format);
    },
  }));
});

const send = (message: Record<string, unknown>) => {
  frame.value?.contentWindow?.postMessage(message, "*");
};

const draw = () => {
  send({ type: "draw", option: props.option, dark: colorMode.value === "dark" });
};

const exportImage = (format: ExportFormat) => {
  exportFormat = format;
  send({ type: "export", format });
};

type FrameMessage = MessageEvent<{ type?: string; message?: string; formats?: unknown; url?: unknown }>;

useEventListener("message", (event: FrameMessage) => {
  if (!event.source || event.source !== frame.value?.contentWindow) {
    return;
  }

  if (event.data.type === "ready") {
    draw();
  } else if (event.data.type === "error") {
    console.error("Failed to draw chart", event.data.message);
    failed.value = true;
  } else if (event.data.type === "drawn") {
    const drawn = event.data.formats;
    formats.value = exportFormats.filter((format) => Array.isArray(drawn) && drawn.includes(format));
  } else if (event.data.type === "export" && exportFormat) {
    const url = event.data.url;
    if (typeof url === "string" && url.startsWith("data:image/")) {
      const link = document.createElement("a");
      link.href = url;
      link.download = `chart.${exportFormat}`;
      link.click();
    }
    exportFormat = undefined;
  }
});

const optionContent = computed(() => {
  return JSON.stringify(props.option, (_key, value: unknown) => {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
      : value;
  });
});

watch([optionContent, () => colorMode.value], draw);

let observer: IntersectionObserver | undefined;

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      visible.value = entries.at(-1)?.isIntersecting ?? false;
    },
    { scrollMargin: "100%" },
  );
  if (container.value) {
    observer.observe(container.value);
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
});
</script>

<template>
  <div ref="container" class="group/chart relative h-96 [&:fullscreen]:bg-default">
    <p v-if="failed" class="flex h-full items-center justify-center text-sm text-muted">
      {{ $t("ai.components.chat.chartFrame.error") }}
    </p>
    <template v-else-if="visible">
      <iframe
        ref="frame"
        class="size-full"
        sandbox="allow-scripts"
        :src="`/api/ai/chart/frame#${colorMode.value}`"
        :title="$t('ai.components.chat.chartFrame.title')"
      />
      <div
        v-if="formats.length > 0"
        class="absolute top-0 right-0 flex transition-opacity ease-out group-hover/chart:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:hover)]:opacity-0"
      >
        <UDropdownMenu :portal="false" :items="exportItems">
          <UButton
            square
            size="sm"
            color="neutral"
            variant="ghost"
            icon="i-lucide-download"
            :aria-label="$t('ai.components.chat.chartFrame.export.label')"
          />
        </UDropdownMenu>
        <UButton
          v-if="canFullscreen"
          square
          size="sm"
          color="neutral"
          variant="ghost"
          :icon="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'"
          :aria-label="$t(`ai.components.chat.chartFrame.fullscreen.${isFullscreen ? 'exit' : 'enter'}`)"
          @click="toggleFullscreen"
        />
      </div>
    </template>
  </div>
</template>
