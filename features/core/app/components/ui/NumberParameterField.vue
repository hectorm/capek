<script setup lang="ts">
import USlider from "@nuxt/ui/components/Slider.vue";
import USwitch from "@nuxt/ui/components/Switch.vue";
import UInput from "@nuxt/ui/components/Input.vue";

const props = defineProps<{
  modelValue?: number | null;
  min: number;
  max: number;
  step: number;
  default: number;
  disabled?: boolean;
  defaultHint?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [number | null] }>();

const toggle = (enabled: boolean) => {
  emit("update:modelValue", enabled ? props.default : null);
};

const commit = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    emit("update:modelValue", value);
  }
};
</script>

<template>
  <div class="flex min-h-5 items-center gap-2 pt-0.5">
    <USwitch size="sm" :disabled="disabled" :model-value="modelValue != null" @update:model-value="toggle" />
    <template v-if="modelValue != null">
      <USlider
        size="sm"
        :max="max"
        :min="min"
        :step="step"
        class="flex-1"
        :disabled="disabled"
        :model-value="modelValue ?? undefined"
        @update:model-value="commit"
      />
      <UInput
        size="sm"
        :max="max"
        :min="min"
        :step="step"
        type="number"
        :disabled="disabled"
        class="h-5 w-28 py-0"
        :model-value="modelValue"
        @update:model-value="commit"
      />
    </template>
    <span v-else class="text-sm text-muted">{{ defaultHint }}</span>
  </div>
</template>
