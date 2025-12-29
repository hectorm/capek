<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";
import { computed } from "vue";

import type { FormSubmitEvent } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UModal from "@nuxt/ui/components/Modal.vue";

import { usePermissions } from "~/composables/permissions";
import { Permissions } from "~~/shared/rbac";

const props = defineProps<{
  id: string;
}>();

const emit = defineEmits<{
  close: [{ deleted: boolean; error: Error | null }];
}>();

const { $trpc } = useNuxtApp();
const { canAny } = usePermissions();

const [llmProvider, currentAccess] = await Promise.all([
  $trpc.llmProvider.read.query({ id: props.id }),
  $trpc.llmProvider.listAccess.query({ llmProviderId: props.id }),
]);

const canDelete = computed(() => {
  const principalIds = currentAccess.filter((a) => a.role === "editor").map((a) => a.id);
  return canAny([Permissions.LlmProviderDeleteAll, Permissions.LlmProviderDeleteOwn], principalIds);
});

const onSubmit = async (_event: FormSubmitEvent<unknown>) => {
  try {
    await $trpc.llmProvider.delete.mutate({ id: llmProvider.id });
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
    :title="$t('pages.studio.llmProviders.delete.title')"
    :description="$t('pages.studio.llmProviders.delete.description')"
  >
    <template #body>
      <UForm :state="{}" class="w-full max-w-150 space-y-4" @submit="onSubmit">
        <div>
          {{ $t("pages.studio.llmProviders.delete.confirm", { name: llmProvider?.name }) }}
        </div>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("pages.studio.llmProviders.form.cancel") }}
          </UButton>
          <UButton color="error" type="submit" variant="solid" :disabled="!canDelete" icon="i-lucide-trash-2">
            {{ $t("pages.studio.llmProviders.form.delete") }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
