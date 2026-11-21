<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";

import type { FormSubmitEvent } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UModal from "@nuxt/ui/components/Modal.vue";

import { useChatStore } from "#layers/ai/app/stores/chat";

import ResourceLoadError from "#layers/core/app/components/ui/ResourceLoadError.vue";

const props = defineProps<{
  id: string;
}>();

const emit = defineEmits<{
  close: [{ deleted: boolean; error: Error | null }];
}>();

const { $trpc } = useNuxtApp();
const chatStore = useChatStore();

const session = await $trpc.ai.chatSession.read.query({ id: props.id }).catch(() => null);

const onSubmit = async (_event: FormSubmitEvent<unknown>): Promise<void> => {
  try {
    await chatStore.deleteSession(props.id);
    emit("close", { deleted: true, error: null });
  } catch (error) {
    emit("close", { deleted: false, error: error as Error });
  }
};

const onCancel = (): void => {
  emit("close", { deleted: false, error: null });
};
</script>

<template>
  <UModal
    :close="false"
    :dismissible="false"
    :title="$t('ai.components.chat.deleteModal.title')"
    :description="$t('ai.components.chat.deleteModal.description')"
  >
    <template #body>
      <ResourceLoadError v-if="!session" @cancel="onCancel" />
      <UForm v-else :state="{}" class="w-full max-w-150 space-y-4" @submit="onSubmit">
        <div>
          {{
            $t("ai.components.chat.deleteModal.form.message", { title: session.title || $t("ai.pages.chat.untitled") })
          }}
        </div>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("ai.components.chat.deleteModal.form.cancel.label") }}
          </UButton>
          <UButton loading-auto color="error" type="submit" variant="solid" icon="i-lucide-trash-2">
            {{ $t("ai.components.chat.deleteModal.form.delete.label") }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
