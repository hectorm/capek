<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";
import { ref } from "vue";

import type { FormSubmitEvent } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UModal from "@nuxt/ui/components/Modal.vue";

import type { RouterOutputs } from "~/types/trpc";

type UserReadOutput = RouterOutputs["user"]["read"];

const props = defineProps<{
  id: string;
}>();

const emit = defineEmits<{
  close: [{ deleted: boolean; error: Error | null }];
}>();

const { $trpc } = useNuxtApp();

const user = ref<UserReadOutput>(await $trpc.user.read.query({ id: props.id }));

const onSubmit = async (_event: FormSubmitEvent<unknown>) => {
  try {
    await $trpc.user.delete.mutate({ id: user.value.id });
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
    :title="$t('components.users.deleteModal.title')"
    :description="$t('components.users.deleteModal.description')"
  >
    <template #body>
      <UForm :state="{}" class="w-full max-w-150 space-y-4" @submit="onSubmit">
        <div>
          {{ $t("components.users.deleteModal.form.message", { username: user?.username }) }}
        </div>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("components.users.deleteModal.form.cancel.label") }}
          </UButton>
          <UButton color="error" type="submit" variant="solid" icon="i-lucide-trash-2">
            {{ $t("components.users.deleteModal.form.delete.label") }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
