<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";
import { ref } from "vue";

import type { FormSubmitEvent } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UModal from "@nuxt/ui/components/Modal.vue";

import type { RouterOutputs } from "~/types/trpc";

type GroupReadOutput = RouterOutputs["group"]["read"];

const props = defineProps<{
  id: string;
}>();

const emit = defineEmits<{
  close: [{ deleted: boolean; error: Error | null }];
}>();

const { $trpc } = useNuxtApp();

const group = ref<GroupReadOutput>(await $trpc.group.read.query({ id: props.id }));

const onSubmit = async (_event: FormSubmitEvent<unknown>) => {
  try {
    await $trpc.group.delete.mutate({ id: group.value.id });
    emit("close", { deleted: true, error: null });
  } catch (error) {
    emit("close", { deleted: false, error: error as Error });
  }
};

const onCancel = () => {
  emit("close", { deleted: false, error: null });
};
</script>

<template>
  <UModal
    :close="false"
    :dismissible="false"
    :title="$t('components.groups.deleteModal.title')"
    :description="$t('components.groups.deleteModal.description')"
  >
    <template #body>
      <UForm :state="{}" class="w-full max-w-150 space-y-4" @submit="onSubmit">
        <div>
          {{ $t("components.groups.deleteModal.form.message", { name: group?.name }) }}
        </div>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("components.groups.deleteModal.form.cancel.label") }}
          </UButton>
          <UButton color="error" type="submit" variant="solid" icon="i-lucide-trash-2">
            {{ $t("components.groups.deleteModal.form.delete.label") }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
