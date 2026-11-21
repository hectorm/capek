<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";
import { computed, reactive } from "vue";
import { z } from "zod/v4";

import type { FormSubmitEvent } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UFormField from "@nuxt/ui/components/FormField.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UModal from "@nuxt/ui/components/Modal.vue";
import UTextarea from "@nuxt/ui/components/Textarea.vue";

import type { RouterInputs, RouterOutputs } from "#layers/core/app/types/trpc";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { useResourceToast } from "#layers/core/app/composables/resource-toast";
import { useUserStore } from "#layers/core/app/stores/user";
import { creatorAccess, fromPrincipalIds, toOwnerIds, toPrincipalIds } from "#layers/core/app/utils/access";

import AccessFields from "#layers/core/app/components/ui/AccessFields.vue";
import ResourceLoadError from "#layers/core/app/components/ui/ResourceLoadError.vue";

type SkillGetOutput = RouterOutputs["ai"]["skill"]["read"];
type SkillCreateInput = RouterInputs["ai"]["skill"]["create"];
type SkillUpdateInput = RouterInputs["ai"]["skill"]["update"];
type SkillCreateOrUpdateInput = SkillCreateInput | SkillUpdateInput;

const props = defineProps<{
  id?: string;
}>();

const emit = defineEmits<{
  close: [{ skill: SkillGetOutput | null }];
}>();

const { notify } = useResourceToast("ai.pages.studio.skills");
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();
const userStore = useUserStore();

const loaded = await Promise.all([
  props.id ? $trpc.ai.skill.read.query({ id: props.id }) : Promise.resolve(null),
  props.id ? $trpc.ai.skill.listAccess.query({ skillId: props.id }) : Promise.resolve([]),
]).catch(() => null);
let [skill, currentAccess] = loaded ?? [null, []];

if (!props.id && userStore.user) {
  currentAccess = creatorAccess(userStore.user);
}

const canModify = computed(() => {
  if (!props.id) {
    return can(AiPermissions.SkillCreate);
  }
  return canAny([AiPermissions.SkillUpdateAll, AiPermissions.SkillUpdateOwn], toOwnerIds(currentAccess));
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
  ...toPrincipalIds(currentAccess),
});

const onSubmit = async (event: FormSubmitEvent<Schema>): Promise<void> => {
  try {
    const access = fromPrincipalIds(event.data);

    if ("id" in event.data && event.data.id) {
      const result = await $trpc.ai.skill.update.mutate({
        id: event.data.id,
        name: event.data.name,
        description: event.data.description,
        documentation: event.data.documentation,
        code: event.data.code,
        access,
      });
      skill = result;
    } else {
      const result = await $trpc.ai.skill.create.mutate({
        name: event.data.name,
        description: event.data.description,
        documentation: event.data.documentation,
        code: event.data.code,
        access,
      });
      skill = result;
      state.id = result.id;
    }

    notify(props.id ? "update" : "create", "success");
    emit("close", { skill });
  } catch {
    notify(props.id ? "update" : "create", "error");
  }
};

const onCancel = (): void => {
  emit("close", { skill: null });
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
      <ResourceLoadError v-if="!loaded" @cancel="onCancel" />
      <UForm
        v-else
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
        <AccessFields
          v-model:users="state.users"
          v-model:editors="state.editors"
          :disabled="!canModify"
          :access="currentAccess"
        />
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("ai.pages.studio.skills.form.cancel") }}
          </UButton>
          <UButton
            loading-auto
            type="submit"
            color="primary"
            variant="solid"
            icon="i-lucide-save"
            :disabled="!canModify"
          >
            {{ $t(`ai.pages.studio.skills.form.${props.id ? "save" : "create"}`) }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
