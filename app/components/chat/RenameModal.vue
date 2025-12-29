<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";
import { reactive, ref } from "vue";
import { z } from "zod/v4";

import type { FormSubmitEvent } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UFormField from "@nuxt/ui/components/FormField.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UModal from "@nuxt/ui/components/Modal.vue";

import type { RouterInputs, RouterOutputs } from "~/types/trpc";

type ChatSessionReadOutput = RouterOutputs["chatSession"]["read"];
type ChatSessionUpdateInput = RouterInputs["chatSession"]["update"];

const props = defineProps<{
  id: string;
}>();

const emit = defineEmits<{
  close: [{ renamed: boolean; error: Error | null }];
}>();

const { $trpc } = useNuxtApp();

const session = ref<ChatSessionReadOutput>(await $trpc.chatSession.read.query({ id: props.id }));

const schema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(500).trim(),
}) satisfies z.ZodType<Partial<ChatSessionUpdateInput>>;

type Schema = z.infer<typeof schema>;

const state = reactive<Partial<ChatSessionUpdateInput>>({
  id: session.value.id,
  title: session.value.title,
});

const onSubmit = async (event: FormSubmitEvent<Schema>) => {
  try {
    if (!event.data.id) {
      emit("close", { renamed: false, error: new Error("Session ID is required") });
      return;
    }

    await $trpc.chatSession.update.mutate({
      id: event.data.id,
      title: event.data.title,
    });
    emit("close", { renamed: true, error: null });
  } catch (error) {
    emit("close", { renamed: false, error: error as Error });
  }
};

const onCancel = () => {
  emit("close", { renamed: false, error: null });
};
</script>

<template>
  <UModal
    :close="false"
    :dismissible="false"
    :title="$t('components.chat.renameModal.title')"
    :description="$t('components.chat.renameModal.description')"
  >
    <template #body>
      <UForm
        :state="state"
        :schema="schema"
        :validate-on="['change']"
        class="w-full max-w-150 space-y-4"
        @submit="onSubmit"
      >
        <UFormField required name="title" :label="$t('components.chat.renameModal.form.title.label')">
          <UInput
            v-model="state.title"
            autofocus
            type="text"
            class="w-full"
            :placeholder="$t('components.chat.renameModal.form.title.placeholder')"
          />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("components.chat.renameModal.form.cancel.label") }}
          </UButton>
          <UButton type="submit" color="primary" variant="solid" icon="i-lucide-save">
            {{ $t("components.chat.renameModal.form.save.label") }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
