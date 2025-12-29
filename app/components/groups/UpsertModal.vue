<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { z } from "zod/v4";

import { useToast } from "#imports";

import type { FormSubmitEvent } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UFormField from "@nuxt/ui/components/FormField.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UModal from "@nuxt/ui/components/Modal.vue";
import USelectMenu from "@nuxt/ui/components/SelectMenu.vue";
import UTextarea from "@nuxt/ui/components/Textarea.vue";

import type { RouterInputs, RouterOutputs } from "~/types/trpc";
import { usePermissions } from "~/composables/permissions";
import { Permissions } from "~~/shared/rbac";

type GroupReadOutput = RouterOutputs["group"]["read"];
type GroupCreateInput = RouterInputs["group"]["create"];
type GroupUpdateInput = RouterInputs["group"]["update"];
type GroupCreateOrUpdateInput = GroupCreateInput | GroupUpdateInput;
type RoleListOutput = RouterOutputs["role"]["list"];

const props = defineProps<{
  id?: string | null;
}>();

const emit = defineEmits<{
  close: [{ group: GroupReadOutput | null; error: Error | null }];
}>();

const i18n = useI18n();
const toast = useToast();
const { $trpc } = useNuxtApp();
const { can } = usePermissions();

const group = ref<GroupReadOutput | null>(props.id ? await $trpc.group.read.query({ id: props.id }) : null);
const roles = ref<RoleListOutput>(await $trpc.role.list.query());

const canUpdateAllGroups = computed(() => can(Permissions.GroupUpdateAll));
const canCreateGroup = computed(() => can(Permissions.GroupCreate));

const canModify = computed(() => {
  if (!props.id) {
    return canCreateGroup.value;
  }
  return canUpdateAllGroups.value;
});

const schema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(1000).trim().default(""),
  roles: z.array(z.string().min(1).max(255).trim().toLowerCase()).max(255).default([]),
}) satisfies z.ZodType<GroupCreateOrUpdateInput>;

type Schema = z.infer<typeof schema>;

const state = reactive<Partial<GroupCreateOrUpdateInput>>({
  id: group.value?.id,
  name: group.value?.name,
  description: group.value?.description,
  roles: group.value?.roles ?? [],
});

const onSubmit = async (event: FormSubmitEvent<Schema>) => {
  try {
    if ("id" in event.data && event.data.id) {
      group.value = await $trpc.group.update.mutate({
        id: event.data.id,
        name: event.data.name,
        description: event.data.description,
        roles: event.data.roles,
      });
    } else {
      group.value = await $trpc.group.create.mutate({
        name: event.data.name,
        description: event.data.description,
        roles: event.data.roles,
      });
    }
    emit("close", { group: group.value, error: null });
  } catch {
    const action = props.id ? "update" : "create";
    toast.add({
      color: "error",
      title: i18n.t(`pages.settings.groups.table.actions.${action}.error.title`),
      description: i18n.t(`pages.settings.groups.table.actions.${action}.error.description`),
    });
  }
};

const onCancel = () => {
  emit("close", { group: null, error: null });
};
</script>

<template>
  <UModal
    :close="false"
    :dismissible="false"
    :title="$t(`components.groups.upsertModal.${props.id ? 'update' : 'create'}.title`)"
    :description="$t(`components.groups.upsertModal.${props.id ? 'update' : 'create'}.description`)"
  >
    <template #body>
      <UForm
        :state="state"
        :schema="schema"
        :validate-on="['change']"
        class="w-full max-w-150 space-y-4"
        @submit="onSubmit"
      >
        <UFormField required name="name" :label="$t('components.groups.upsertModal.form.name.label')">
          <UInput v-model="state.name" class="w-full" :disabled="!canModify" />
        </UFormField>
        <UFormField name="description" :label="$t('components.groups.upsertModal.form.description.label')">
          <UTextarea v-model="state.description" autoresize :maxrows="10" class="w-full" :disabled="!canModify" />
        </UFormField>
        <UFormField name="roles" :label="$t('components.groups.upsertModal.form.roles.label')">
          <USelectMenu
            v-model="state.roles"
            multiple
            class="w-full"
            :disabled="!canModify"
            :items="roles.map((r) => r.name)"
            :aria-label="$t('components.groups.upsertModal.form.roles.label')"
          />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("components.groups.upsertModal.form.cancel.label") }}
          </UButton>
          <UButton type="submit" color="primary" variant="solid" icon="i-lucide-save" :disabled="!canModify">
            {{ $t("components.groups.upsertModal.form.save.label") }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
