<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";
import { computed, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { z } from "zod/v4";

import { useToast } from "#imports";

import type { FormSubmitEvent } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UFormField from "@nuxt/ui/components/FormField.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UModal from "@nuxt/ui/components/Modal.vue";
import UTextarea from "@nuxt/ui/components/Textarea.vue";

import type { RouterInputs, RouterOutputs } from "~/types/trpc";
import { usePermissions } from "~/composables/permissions";
import { usePrincipalSearch } from "~/composables/principal-search";
import { useUserStore } from "~/stores/user";
import { Permissions } from "~~/shared/rbac";

import SearchMenu from "~/components/ui/SearchMenu.vue";

type SkillGetOutput = RouterOutputs["skill"]["read"];
type SkillCreateInput = RouterInputs["skill"]["create"];
type SkillUpdateInput = RouterInputs["skill"]["update"];
type SkillCreateOrUpdateInput = SkillCreateInput | SkillUpdateInput;

const props = defineProps<{
  id?: string | null;
}>();

const emit = defineEmits<{
  close: [{ skill: SkillGetOutput | null; error: Error | null }];
}>();

const i18n = useI18n();
const toast = useToast();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();
const { search, getLabel, getIcon, preload } = usePrincipalSearch();
const userStore = useUserStore();

let [skill, currentAccess] = await Promise.all([
  props.id ? $trpc.skill.read.query({ id: props.id }) : Promise.resolve(null),
  props.id ? $trpc.skill.listAccess.query({ skillId: props.id }) : Promise.resolve([]),
]);

if (!props.id && userStore.user) {
  currentAccess = [
    {
      id: userStore.user.id,
      type: "user" as const,
      role: "editor" as const,
      username: userStore.user.username,
      email: userStore.user.email,
    },
    {
      id: userStore.user.id,
      type: "user" as const,
      role: "user" as const,
      username: userStore.user.username,
      email: userStore.user.email,
    },
  ];
}

const canModify = computed(() => {
  if (!props.id) {
    return can(Permissions.SkillCreate);
  }
  const principalIds = currentAccess.filter((a) => a.role === "editor").map((a) => a.id);
  return canAny([Permissions.SkillUpdateAll, Permissions.SkillUpdateOwn], principalIds);
});

const schema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(1000).trim().default(""),
  documentation: z.string().max(100000).trim().optional(),
  code: z.string().max(100000).optional(),
  editors: z.array(z.string()).default([]),
  users: z.array(z.string()).default([]),
});

type Schema = z.infer<typeof schema>;

const editors = currentAccess.filter((a) => a.role === "editor");
const editorIds = editors.map((a) => `${a.type}:${a.id}`);

const users = currentAccess.filter((a) => a.role === "user");
const userIds = users.map((a) => `${a.type}:${a.id}`);

preload(currentAccess);

const defaultCode = [
  "// Import MCP tools from available servers",
  "// import { $myTool } from '/servers/myServer/index.js';",
  "// Import skills",
  "// import { $mySkill } from '/skills/index.js';",
  "",
  "/**",
  " * Brief description for agent discovery.",
  " * @param {Object} params",
  " * @param {string} params.myString - A string parameter",
  " * @param {number} params.myNumber - A number parameter",
  " * @param {boolean} params.myBoolean - A boolean parameter",
  " * @param {string[]} params.myArray - An array of strings",
  " * @param {'a'|'b'|'c'} params.myEnum - One of the allowed values",
  " * @param {Object} params.myObject - An object parameter",
  " * @param {string} params.myObject.nested - A nested property",
  " * @param {string} [params.myOptional] - An optional string",
  " */",
  "export default async function (params) {",
  "  // const toolResult = await $myTool({ myString: params.myString });",
  "  // const skillResult = await $mySkill({ myString: params.myString });",
  "  return params;",
  "}",
].join("\n");

const state = reactive<
  Partial<SkillCreateOrUpdateInput> & {
    id?: string;
    documentation?: string;
    code?: string;
    editors: string[];
    users: string[];
  }
>({
  id: skill?.id,
  name: skill?.name,
  description: skill?.description,
  documentation: skill?.documentation ?? undefined,
  code: skill?.code ?? defaultCode,
  editors: editorIds,
  users: userIds,
});

const onSubmit = async (event: FormSubmitEvent<Schema>) => {
  try {
    let skillId: string;

    if ("id" in event.data && event.data.id) {
      const result = await $trpc.skill.update.mutate({
        id: event.data.id,
        name: event.data.name,
        description: event.data.description,
        documentation: event.data.documentation,
        code: event.data.code,
      });
      skill = result;
      skillId = result.id;
    } else {
      const result = await $trpc.skill.create.mutate({
        name: event.data.name,
        description: event.data.description,
        documentation: event.data.documentation,
        code: event.data.code,
      });
      skill = result;
      skillId = result.id;
    }

    const access = [
      ...event.data.editors.map((compositeId) => {
        const [type, id] = compositeId.split(":");
        return { id: id ?? "", type: type as "user" | "group", role: "editor" as const };
      }),
      ...event.data.users.map((compositeId) => {
        const [type, id] = compositeId.split(":");
        return { id: id ?? "", type: type as "user" | "group", role: "user" as const };
      }),
    ];
    await $trpc.skill.syncAccess.mutate({ skillId, access });

    emit("close", { skill, error: null });
  } catch {
    const action = props.id ? "update" : "create";
    toast.add({
      color: "error",
      title: i18n.t(`pages.studio.skills.table.actions.${action}.error.title`),
      description: i18n.t(`pages.studio.skills.table.actions.${action}.error.description`),
    });
  }
};

const onCancel = () => {
  emit("close", { skill: null, error: null });
};
</script>

<template>
  <UModal
    :close="false"
    :dismissible="false"
    :title="$t(`pages.studio.skills.${props.id ? 'edit' : 'create'}.title`)"
    :description="$t(`pages.studio.skills.${props.id ? 'edit' : 'create'}.description`)"
  >
    <template #body>
      <UForm
        :state="state"
        :schema="schema"
        :validate-on="['change']"
        class="w-full max-w-150 space-y-4"
        @submit="onSubmit"
      >
        <UFormField required name="name" :label="$t('pages.studio.skills.form.name.label')">
          <UInput
            v-model="state.name"
            type="text"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('pages.studio.skills.form.name.placeholder')"
          />
        </UFormField>
        <UFormField name="description" :label="$t('pages.studio.skills.form.description.label')">
          <UTextarea
            v-model="state.description"
            autoresize
            :maxrows="3"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('pages.studio.skills.form.description.placeholder')"
          />
        </UFormField>
        <UFormField name="documentation" :label="$t('pages.studio.skills.form.documentation.label')">
          <UTextarea
            v-model="state.documentation"
            autoresize
            :minrows="5"
            :maxrows="15"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('pages.studio.skills.form.documentation.placeholder')"
          />
        </UFormField>
        <UFormField name="code" :label="$t('pages.studio.skills.form.code.label')">
          <UTextarea
            v-model="state.code"
            autoresize
            :minrows="10"
            :disabled="!canModify"
            class="w-full font-mono text-sm"
            :ui="{ base: 'whitespace-pre overflow-x-auto' }"
            :placeholder="$t('pages.studio.skills.form.code.placeholder')"
          />
        </UFormField>
        <UFormField name="editors" :label="$t('pages.studio.skills.form.editors.label')">
          <SearchMenu
            v-model="state.editors"
            multiple
            class="w-full"
            :icon-fn="getIcon"
            :search-fn="search"
            :label-fn="getLabel"
            :disabled="!canModify"
            :placeholder="$t('pages.studio.skills.form.editors.placeholder')"
          />
        </UFormField>
        <UFormField name="users" :label="$t('pages.studio.skills.form.users.label')">
          <SearchMenu
            v-model="state.users"
            multiple
            class="w-full"
            :icon-fn="getIcon"
            :search-fn="search"
            :label-fn="getLabel"
            :disabled="!canModify"
            :placeholder="$t('pages.studio.skills.form.users.placeholder')"
          />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("pages.studio.skills.form.cancel") }}
          </UButton>
          <UButton type="submit" color="primary" variant="solid" icon="i-lucide-save" :disabled="!canModify">
            {{ $t(`pages.studio.skills.form.${props.id ? "save" : "create"}`) }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
