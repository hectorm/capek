<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";
import { computed, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { z } from "zod/v4";

import type { FormSubmitEvent } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UFormField from "@nuxt/ui/components/FormField.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UModal from "@nuxt/ui/components/Modal.vue";
import UTextarea from "@nuxt/ui/components/Textarea.vue";
import { useToast } from "@nuxt/ui/composables/useToast";

import type { RouterInputs, RouterOutputs } from "#layers/core/app/types/trpc";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { usePrincipalSearch } from "#layers/core/app/composables/principal-search";
import { fromPrincipalIds, toPrincipalIds } from "#layers/core/app/utils/access";
import { useUserStore } from "#layers/core/app/stores/user";
import { AiPermissions } from "#layers/ai/shared/rbac";

import SearchMenu from "#layers/core/app/components/ui/SearchMenu.vue";

type SkillGetOutput = RouterOutputs["ai"]["skill"]["read"];
type SkillCreateInput = RouterInputs["ai"]["skill"]["create"];
type SkillUpdateInput = RouterInputs["ai"]["skill"]["update"];
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
  props.id ? $trpc.ai.skill.read.query({ id: props.id }) : Promise.resolve(null),
  props.id ? $trpc.ai.skill.listAccess.query({ skillId: props.id }) : Promise.resolve([]),
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
    return can(AiPermissions.SkillCreate);
  }
  const principalIds = currentAccess.filter((a) => a.role === "editor").map((a) => a.id);
  return canAny([AiPermissions.SkillUpdateAll, AiPermissions.SkillUpdateOwn], principalIds);
});

const schema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).trim().default(""),
  documentation: z.string().max(100000).trim().optional(),
  code: z.string().max(100000).optional(),
  editors: z.array(z.string()).default([]),
  users: z.array(z.string()).default([]),
});

type Schema = z.infer<typeof schema>;

const editorIds = toPrincipalIds(currentAccess, "editor");
const userIds = toPrincipalIds(currentAccess, "user");

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
  code: skill?.code ?? (props.id ? undefined : defaultCode),
  editors: editorIds,
  users: userIds,
});

const onSubmit = async (event: FormSubmitEvent<Schema>) => {
  try {
    let skillId: string;

    if ("id" in event.data && event.data.id) {
      const result = await $trpc.ai.skill.update.mutate({
        id: event.data.id,
        name: event.data.name,
        description: event.data.description,
        documentation: event.data.documentation,
        code: event.data.code,
      });
      skill = result;
      skillId = result.id;
    } else {
      const result = await $trpc.ai.skill.create.mutate({
        name: event.data.name,
        description: event.data.description,
        documentation: event.data.documentation,
        code: event.data.code,
      });
      skill = result;
      skillId = result.id;
    }

    const access = fromPrincipalIds(event.data);
    await $trpc.ai.skill.syncAccess.mutate({ skillId, access });

    emit("close", { skill, error: null });
  } catch {
    const action = props.id ? "update" : "create";
    toast.add({
      color: "error",
      title: i18n.t(`ai.pages.studio.skills.table.actions.${action}.error.title`),
      description: i18n.t(`ai.pages.studio.skills.table.actions.${action}.error.description`),
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
    :title="$t(`ai.pages.studio.skills.${props.id ? 'edit' : 'create'}.title`)"
    :description="$t(`ai.pages.studio.skills.${props.id ? 'edit' : 'create'}.description`)"
  >
    <template #body>
      <UForm
        :state="state"
        :schema="schema"
        :validate-on="['change']"
        class="w-full max-w-150 space-y-4"
        @submit="onSubmit"
      >
        <UFormField required name="name" :label="$t('ai.pages.studio.skills.form.name.label')">
          <UInput
            v-model="state.name"
            type="text"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.skills.form.name.placeholder')"
          />
        </UFormField>
        <UFormField name="description" :label="$t('ai.pages.studio.skills.form.description.label')">
          <UTextarea
            v-model="state.description"
            autoresize
            :maxrows="3"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.skills.form.description.placeholder')"
          />
        </UFormField>
        <UFormField name="documentation" :label="$t('ai.pages.studio.skills.form.documentation.label')">
          <UTextarea
            v-model="state.documentation"
            autoresize
            :minrows="5"
            :maxrows="15"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.skills.form.documentation.placeholder')"
          />
        </UFormField>
        <UFormField name="code" :label="$t('ai.pages.studio.skills.form.code.label')">
          <UTextarea
            v-model="state.code"
            autoresize
            :minrows="10"
            :disabled="!canModify"
            class="w-full font-mono text-sm"
            :ui="{ base: 'whitespace-pre overflow-x-auto' }"
            :placeholder="$t('ai.pages.studio.skills.form.code.placeholder')"
          />
        </UFormField>
        <UFormField name="editors" :label="$t('ai.pages.studio.skills.form.editors.label')">
          <SearchMenu
            v-model="state.editors"
            multiple
            class="w-full"
            :icon-fn="getIcon"
            :search-fn="search"
            :label-fn="getLabel"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.skills.form.editors.placeholder')"
          />
        </UFormField>
        <UFormField name="users" :label="$t('ai.pages.studio.skills.form.users.label')">
          <SearchMenu
            v-model="state.users"
            multiple
            class="w-full"
            :icon-fn="getIcon"
            :search-fn="search"
            :label-fn="getLabel"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.skills.form.users.placeholder')"
          />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("ai.pages.studio.skills.form.cancel") }}
          </UButton>
          <UButton type="submit" color="primary" variant="solid" icon="i-lucide-save" :disabled="!canModify">
            {{ $t(`ai.pages.studio.skills.form.${props.id ? "save" : "create"}`) }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
