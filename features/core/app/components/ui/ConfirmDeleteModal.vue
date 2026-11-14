<script setup lang="ts">
import { computed } from "vue";

import type { FormSubmitEvent } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UModal from "@nuxt/ui/components/Modal.vue";

import type { PermissionName, Principal } from "#layers/core/shared/rbac";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { useResourceToast } from "#layers/core/app/composables/resource-toast";
import { toOwnerIds } from "#layers/core/app/utils/access";

const props = defineProps<{
  // Prefix of the resource messages, used for its "delete.*" and "actions.delete.*" keys
  i18nPrefix: string;
  name: string;
  deletePermissions: PermissionName[];
  // Omitted for resources without owners, which only the ":all" permissions can delete
  loadAccess?: () => Promise<Principal[]>;
  remove: () => Promise<unknown>;
}>();

const emit = defineEmits<{
  close: [{ deleted: boolean }];
}>();

const { canAny } = usePermissions();
const { notify } = useResourceToast(props.i18nPrefix);

const access = props.loadAccess ? await props.loadAccess() : [];

const canDelete = computed(() => canAny(props.deletePermissions, toOwnerIds(access)));

const onSubmit = async (_event: FormSubmitEvent<unknown>) => {
  try {
    await props.remove();
    notify("delete", "success");
    emit("close", { deleted: true });
  } catch {
    notify("delete", "error");
    emit("close", { deleted: false });
  }
};

const onCancel = () => {
  emit("close", { deleted: false });
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
          {{ $t(`${props.i18nPrefix}.delete.confirm`, { name: props.name }) }}
        </div>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("components.confirmDeleteModal.cancel") }}
          </UButton>
          <UButton
            loading-auto
            color="error"
            type="submit"
            variant="solid"
            :disabled="!canDelete"
            icon="i-lucide-trash-2"
          >
            {{ $t("components.confirmDeleteModal.delete") }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
