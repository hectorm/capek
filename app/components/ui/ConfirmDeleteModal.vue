<script setup lang="ts">
import { computed, ref } from "vue";

import type { FormSubmitEvent } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UModal from "@nuxt/ui/components/Modal.vue";

import type { PermissionName } from "~~/shared/rbac";
import { usePermissions } from "~/composables/permissions";

const props = defineProps<{
  id: string;
  i18nPrefix: string;
  deletePermissions: PermissionName[];
  load: (id: string) => Promise<{ name: string; editorPrincipalIds: string[] }>;
  remove: (id: string) => Promise<void>;
}>();

const emit = defineEmits<{
  close: [{ deleted: boolean; error: Error | null }];
}>();

const { canAny } = usePermissions();

const loaded = await props.load(props.id);
const name = ref<string>(loaded.name);

const canDelete = computed(() => canAny(props.deletePermissions, loaded.editorPrincipalIds));

const onSubmit = async (_event: FormSubmitEvent<unknown>) => {
  try {
    await props.remove(props.id);
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
    :title="$t(`${props.i18nPrefix}.delete.title`)"
    :description="$t(`${props.i18nPrefix}.delete.description`)"
  >
    <template #body>
      <UForm :state="{}" class="w-full max-w-150 space-y-4" @submit="onSubmit">
        <div>
          {{ $t(`${props.i18nPrefix}.delete.confirm`, { name }) }}
        </div>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t(`${props.i18nPrefix}.form.cancel`) }}
          </UButton>
          <UButton color="error" type="submit" variant="solid" :disabled="!canDelete" icon="i-lucide-trash-2">
            {{ $t(`${props.i18nPrefix}.form.delete`) }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
