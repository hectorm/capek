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

const [skill, currentAccess] = await Promise.all([
  $trpc.skill.read.query({ id: props.id }),
  $trpc.skill.principals.query({ id: props.id }),
]);

const canDelete = computed(() => {
  const principalIds = currentAccess.filter((a) => a.role === "editor").map((a) => a.id);
  return canAny([Permissions.SkillDeleteAll, Permissions.SkillDeleteOwn], principalIds);
});

const onSubmit = async (_event: FormSubmitEvent<unknown>) => {
  try {
    await $trpc.skill.delete.mutate({ id: skill.id });
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
    :title="$t('pages.studio.skills.delete.title')"
    :description="$t('pages.studio.skills.delete.description')"
  >
    <template #body>
      <UForm :state="{}" class="w-full max-w-150 space-y-4" @submit="onSubmit">
        <div>
          {{ $t("pages.studio.skills.delete.confirm", { name: skill?.name }) }}
        </div>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("pages.studio.skills.form.cancel") }}
          </UButton>
          <UButton color="error" type="submit" variant="solid" :disabled="!canDelete" icon="i-lucide-trash-2">
            {{ $t("pages.studio.skills.form.delete") }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
