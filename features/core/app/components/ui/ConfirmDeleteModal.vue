<script setup lang="ts">
import { isTRPCClientError } from "@trpc/client";
import { computed, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { z } from "zod/v4";

import type { AppRouter } from "#features/router";

import type { FormSubmitEvent } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UFormField from "@nuxt/ui/components/FormField.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UModal from "@nuxt/ui/components/Modal.vue";

import type { PermissionName, Principal } from "#layers/core/shared/rbac";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { useResourceToast } from "#layers/core/app/composables/resource-toast";
import { toOwnerIds } from "#layers/core/app/utils/access";

import ResourceLoadError from "#layers/core/app/components/ui/ResourceLoadError.vue";

const props = withDefaults(
  defineProps<{
    // Prefix of the "delete.*" and "actions.delete.*" messages of the resource
    i18nPrefix: string;
    name: string;
    deletePermissions: PermissionName[];
    // Omitted when only the ":all" permissions can delete the resource
    loadAccess?: () => Promise<Principal[]>;
    // Set when the user owns the resource or reaches it through inherited access
    isOwner?: boolean;
    // Turned off where a wrong deletion costs little, such as a single file
    requireName?: boolean;
    remove: () => Promise<unknown>;
  }>(),
  {
    loadAccess: undefined,
    isOwner: false,
    requireName: true,
  },
);

const emit = defineEmits<{
  close: [{ deleted: boolean }];
}>();

const i18n = useI18n();
const { notify } = useResourceToast(props.i18nPrefix);
const { canAny } = usePermissions();

const access = props.loadAccess ? await props.loadAccess().catch(() => null) : [];

const canDelete = computed(() => {
  if (props.isOwner) {
    return canAny(props.deletePermissions);
  }
  return access !== null && canAny(props.deletePermissions, toOwnerIds(access));
});

// Typing the name keeps a stray click from deleting the resource
const schema = z.object({
  name: z
    .string()
    .trim()
    .refine((value) => !props.requireName || value === props.name, {
      message: i18n.t("components.confirmDeleteModal.form.name.mismatch"),
    }),
});

type Schema = z.infer<typeof schema>;

const state = reactive<{ name: string }>({
  name: "",
});

const isConfirmed = computed(() => !props.requireName || state.name.trim() === props.name);

const onSubmit = async (_event: FormSubmitEvent<Schema>): Promise<void> => {
  try {
    await props.remove();
    notify("delete", "success");
    emit("close", { deleted: true });
  } catch (error) {
    const conflict = isTRPCClientError<AppRouter>(error) && error.data?.code === "CONFLICT";
    notify("delete", "error", conflict ? i18n.t("components.resource.deleteConflict") : undefined);
    emit("close", { deleted: false });
  }
};

const onCancel = (): void => {
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
      <ResourceLoadError v-if="access === null" @cancel="onCancel" />
      <UForm
        v-else
        :state="state"
        :schema="schema"
        :validate-on="['change']"
        class="w-full max-w-150 space-y-4"
        @submit="onSubmit"
      >
        <div v-if="!props.requireName">
          {{ $t(`${props.i18nPrefix}.delete.confirm`, { name: props.name }) }}
        </div>
        <UFormField
          v-else
          name="name"
          :ui="{ label: 'wrap-anywhere' }"
          :label="$t('components.confirmDeleteModal.form.name.label', { name: props.name })"
        >
          <UInput v-model="state.name" autofocus type="text" class="w-full" autocomplete="off" :disabled="!canDelete" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("components.resource.cancel") }}
          </UButton>
          <UButton
            loading-auto
            color="error"
            type="submit"
            variant="solid"
            icon="i-lucide-trash-2"
            :disabled="!canDelete || !isConfirmed"
          >
            {{ $t("components.resource.delete") }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
