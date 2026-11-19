<script setup lang="ts">
import UButton from "@nuxt/ui/components/Button.vue";

const emit = defineEmits<{ cancel: [] }>();
</script>

<template>
  <div class="flex flex-col gap-4">
    <p role="alert" class="text-sm text-error">{{ $t("components.resource.loadError") }}</p>
    <UButton color="neutral" class="self-end" variant="subtle" @click="emit('cancel')">
      {{ $t("components.resource.cancel") }}
    </UButton>
  </div>
</template>
