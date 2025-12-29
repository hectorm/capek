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

import type { RouterInputs, RouterOutputs } from "~/types/trpc";
import { usePermissions } from "~/composables/permissions";
import { Permissions } from "~~/shared/rbac";

import SearchMenu from "~/components/ui/SearchMenu.vue";

type UserReadOutput = RouterOutputs["user"]["read"];
type UserCreateInput = RouterInputs["user"]["create"];
type UserUpdateInput = RouterInputs["user"]["update"];
type UserCreateOrUpdateInput = UserCreateInput | UserUpdateInput;
type RoleListOutput = RouterOutputs["role"]["list"];

const props = defineProps<{
  id?: string | null;
}>();

const emit = defineEmits<{
  close: [{ user: UserReadOutput | null; error: Error | null }];
}>();

const i18n = useI18n();
const toast = useToast();
const { $trpc } = useNuxtApp();
const { can } = usePermissions();

const user = ref<UserReadOutput | null>(props.id ? await $trpc.user.read.query({ id: props.id }) : null);
const roles = ref<RoleListOutput>(await $trpc.role.list.query());

const canUpdateAllUsers = computed(() => can(Permissions.UserUpdateAll));
const canCreateUser = computed(() => can(Permissions.UserCreate));

const canModify = computed(() => {
  if (!props.id) {
    return canCreateUser.value;
  }
  return canUpdateAllUsers.value;
});

const schema = z.object({
  id: z.uuid().optional(),
  username: z.string().min(1).max(255).trim(),
  fullname: z.string().min(1).max(255).trim(),
  email: z.email({ pattern: z.regexes.unicodeEmail }).max(255).trim().toLowerCase(),
  roles: z.array(z.string().min(1).max(255).trim().toLowerCase()).max(255).optional(),
  groups: z.array(z.string().min(1).max(255).trim()).max(255).optional(),
}) satisfies z.ZodType<UserCreateOrUpdateInput>;

type Schema = z.infer<typeof schema>;

const state = reactive<Partial<UserCreateOrUpdateInput>>({
  id: user.value?.id,
  username: user.value?.username,
  fullname: user.value?.fullname,
  email: user.value?.email,
  roles: user.value?.roles ?? [],
  groups: user.value?.groups ?? [],
});

const onSubmit = async (event: FormSubmitEvent<Schema>) => {
  try {
    if ("id" in event.data && event.data.id) {
      user.value = await $trpc.user.update.mutate({
        id: event.data.id,
        username: event.data.username,
        fullname: event.data.fullname,
        email: event.data.email,
        roles: event.data.roles,
        groups: event.data.groups,
      });
    } else {
      user.value = await $trpc.user.create.mutate({
        username: event.data.username,
        fullname: event.data.fullname,
        email: event.data.email,
        roles: event.data.roles,
        groups: event.data.groups,
      });
    }
    emit("close", { user: user.value, error: null });
  } catch {
    const action = props.id ? "update" : "create";
    toast.add({
      color: "error",
      title: i18n.t(`pages.settings.users.table.actions.${action}.error.title`),
      description: i18n.t(`pages.settings.users.table.actions.${action}.error.description`),
    });
  }
};

const onCancel = () => {
  emit("close", { user: null, error: null });
};
</script>

<template>
  <UModal
    :close="false"
    :dismissible="false"
    :title="$t(`components.users.upsertModal.${props.id ? 'update' : 'create'}.title`)"
    :description="$t(`components.users.upsertModal.${props.id ? 'update' : 'create'}.description`)"
  >
    <template #body>
      <UForm
        :state="state"
        :schema="schema"
        :validate-on="['change']"
        class="w-full max-w-150 space-y-4"
        @submit="onSubmit"
      >
        <UFormField required name="username" :label="$t('components.users.upsertModal.form.username.label')">
          <UInput v-model="state.username" class="w-full" :disabled="!canModify" />
        </UFormField>
        <UFormField required name="fullname" :label="$t('components.users.upsertModal.form.fullname.label')">
          <UInput v-model="state.fullname" class="w-full" :disabled="!canModify" />
        </UFormField>
        <UFormField required name="email" :label="$t('components.users.upsertModal.form.email.label')">
          <UInput v-model="state.email" class="w-full" :disabled="!canModify" />
        </UFormField>
        <UFormField name="roles" :label="$t('components.users.upsertModal.form.roles.label')">
          <USelectMenu
            v-model="state.roles"
            multiple
            class="w-full"
            :disabled="!canModify"
            :items="roles.map((r) => r.name)"
            :aria-label="$t('components.users.upsertModal.form.roles.label')"
          />
        </UFormField>
        <UFormField name="groups" :label="$t('components.users.upsertModal.form.groups.label')">
          <SearchMenu
            v-model="state.groups"
            multiple
            class="w-full"
            :disabled="!canModify"
            :aria-label="$t('components.users.upsertModal.form.groups.label')"
            :search-fn="
              async (search) => {
                const result = await $trpc.group.search.query({ search });
                return result.groups.map((g) => g.name);
              }
            "
          />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("components.users.upsertModal.form.cancel.label") }}
          </UButton>
          <UButton type="submit" color="primary" variant="solid" icon="i-lucide-save" :disabled="!canModify">
            {{ $t("components.users.upsertModal.form.save.label") }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
