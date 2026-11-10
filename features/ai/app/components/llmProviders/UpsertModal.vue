<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";
import { computed, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { z } from "zod/v4";

import type { FormSubmitEvent } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UFieldGroup from "@nuxt/ui/components/FieldGroup.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UFormField from "@nuxt/ui/components/FormField.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UModal from "@nuxt/ui/components/Modal.vue";
import URadioGroup from "@nuxt/ui/components/RadioGroup.vue";
import UTextarea from "@nuxt/ui/components/Textarea.vue";
import { useToast } from "@nuxt/ui/composables/useToast";

import type { RouterInputs, RouterOutputs } from "#layers/core/app/types/trpc";
import type { HttpHeader } from "#layers/core/shared/http";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { usePrincipalSearch } from "#layers/core/app/composables/principal-search";
import { fromPrincipalIds, toPrincipalIds } from "#layers/core/app/utils/access";
import { useUserStore } from "#layers/core/app/stores/user";
import { HttpHeadersSchema, HttpRedactedValue } from "#layers/core/shared/http";
import { OpenAIApiTypeSchema } from "#layers/ai/shared/openai";
import { AiPermissions } from "#layers/ai/shared/rbac";

import SearchMenu from "#layers/core/app/components/ui/SearchMenu.vue";

type LlmProviderGetOutput = RouterOutputs["ai"]["llmProvider"]["read"];
type LlmProviderCreateInput = RouterInputs["ai"]["llmProvider"]["create"];
type LlmProviderUpdateInput = RouterInputs["ai"]["llmProvider"]["update"];
type LlmProviderCreateOrUpdateInput = LlmProviderCreateInput | LlmProviderUpdateInput;

const props = defineProps<{
  id?: string | null;
}>();

const emit = defineEmits<{
  close: [{ llmProvider: LlmProviderGetOutput | null; error: Error | null }];
}>();

const i18n = useI18n();
const toast = useToast();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();
const { search, getLabel, getIcon, preload } = usePrincipalSearch();
const userStore = useUserStore();

let [llmProvider, currentAccess] = await Promise.all([
  props.id ? $trpc.ai.llmProvider.read.query({ id: props.id }) : Promise.resolve(null),
  props.id ? $trpc.ai.llmProvider.listAccess.query({ llmProviderId: props.id }) : Promise.resolve([]),
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
    return can(AiPermissions.LlmProviderCreate);
  }
  const principalIds = currentAccess.filter((a) => a.role === "editor").map((a) => a.id);
  return canAny([AiPermissions.LlmProviderUpdateAll, AiPermissions.LlmProviderUpdateOwn], principalIds);
});

const schema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(1000).trim().default(""),
  apiUrl: z.url(),
  apiType: OpenAIApiTypeSchema,
  apiKey: z.string().max(1000).trim().default(""),
  headers: HttpHeadersSchema.default([]),
  editors: z.array(z.string()).default([]),
  users: z.array(z.string()).default([]),
});

type Schema = z.infer<typeof schema>;

const editorIds = toPrincipalIds(currentAccess, "editor");
const userIds = toPrincipalIds(currentAccess, "user");

preload(currentAccess);

const state = reactive<
  Partial<LlmProviderCreateOrUpdateInput> & {
    headers: HttpHeader[];
    editors: string[];
    users: string[];
  }
>({
  id: llmProvider?.id,
  name: llmProvider?.name,
  description: llmProvider?.description,
  apiUrl: llmProvider?.apiUrl,
  apiType: llmProvider?.apiType ?? "chat-completions",
  apiKey: llmProvider?.apiKey,
  headers: llmProvider?.headers ?? [],
  editors: editorIds,
  users: userIds,
});

const apiTypeOptions = [
  { value: "chat-completions", label: i18n.t("ai.pages.studio.llmProviders.form.apiType.chatCompletions") },
  { value: "responses", label: i18n.t("ai.pages.studio.llmProviders.form.apiType.responses") },
];

const addHeader = () => {
  state.headers.push({ name: "", value: "" });
};

const removeHeader = (index: number) => {
  state.headers.splice(index, 1);
};

const onSubmit = async (event: FormSubmitEvent<Schema>) => {
  try {
    let llmProviderId: string;

    if ("id" in event.data && event.data.id) {
      const result = await $trpc.ai.llmProvider.update.mutate({
        id: event.data.id,
        name: event.data.name,
        description: event.data.description,
        apiUrl: event.data.apiUrl,
        apiType: event.data.apiType,
        apiKey: event.data.apiKey,
        headers: event.data.headers,
      });
      llmProvider = result;
      llmProviderId = result.id;
    } else {
      const result = await $trpc.ai.llmProvider.create.mutate({
        name: event.data.name,
        description: event.data.description,
        apiUrl: event.data.apiUrl,
        apiType: event.data.apiType,
        apiKey: event.data.apiKey,
        headers: event.data.headers,
      });
      llmProvider = result;
      llmProviderId = result.id;
    }

    const access = fromPrincipalIds(event.data);
    await $trpc.ai.llmProvider.syncAccess.mutate({ llmProviderId, access });

    emit("close", { llmProvider, error: null });
  } catch {
    const action = props.id ? "update" : "create";
    toast.add({
      color: "error",
      title: i18n.t(`ai.pages.studio.llmProviders.table.actions.${action}.error.title`),
      description: i18n.t(`ai.pages.studio.llmProviders.table.actions.${action}.error.description`),
    });
  }
};

const onCancel = () => {
  emit("close", { llmProvider: null, error: null });
};
</script>

<template>
  <UModal
    :close="false"
    :dismissible="false"
    :title="$t(`ai.pages.studio.llmProviders.${props.id ? 'edit' : 'create'}.title`)"
    :description="$t(`ai.pages.studio.llmProviders.${props.id ? 'edit' : 'create'}.description`)"
  >
    <template #body>
      <UForm
        :state="state"
        :schema="schema"
        :validate-on="['change']"
        class="w-full max-w-150 space-y-4"
        @submit="onSubmit"
      >
        <UFormField required name="name" :label="$t('ai.pages.studio.llmProviders.form.name.label')">
          <UInput
            v-model="state.name"
            type="text"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.llmProviders.form.name.placeholder')"
          />
        </UFormField>
        <UFormField name="description" :label="$t('ai.pages.studio.llmProviders.form.description.label')">
          <UTextarea
            v-model="state.description"
            autoresize
            :maxrows="3"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.llmProviders.form.description.placeholder')"
          />
        </UFormField>
        <UFormField required name="apiUrl" :label="$t('ai.pages.studio.llmProviders.form.apiUrl.label')">
          <UInput
            v-model="state.apiUrl"
            type="url"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.llmProviders.form.apiUrl.placeholder')"
          />
        </UFormField>
        <UFormField required name="apiType" :label="$t('ai.pages.studio.llmProviders.form.apiType.label')">
          <URadioGroup
            v-model="state.apiType"
            size="sm"
            variant="table"
            :disabled="!canModify"
            :items="apiTypeOptions"
            orientation="horizontal"
          />
        </UFormField>
        <UFormField name="apiKey" :label="$t('ai.pages.studio.llmProviders.form.apiKey.label')">
          <UInput
            v-model="state.apiKey"
            class="w-full"
            type="password"
            :disabled="!canModify"
            :placeholder="$t(`ai.pages.studio.llmProviders.form.apiKey.placeholder`)"
            @input="state.apiKey === HttpRedactedValue && (state.apiKey = '')"
          />
        </UFormField>
        <UFormField name="headers" :label="$t('ai.pages.studio.llmProviders.form.headers.label')">
          <div class="flex flex-col gap-2">
            <UFieldGroup v-for="(header, index) in state.headers" :key="index">
              <UInput
                v-model="header.name"
                required
                type="text"
                class="w-1/3"
                color="neutral"
                variant="outline"
                autocomplete="off"
                :disabled="!canModify"
                pattern="[a-zA-Z0-9!#$%&'*+\-.^_`\|~]+"
                :placeholder="$t('ai.pages.studio.llmProviders.form.headers.namePlaceholder')"
              />
              <UInput
                v-model="header.value"
                required
                class="flex-1"
                color="neutral"
                type="password"
                variant="outline"
                autocomplete="off"
                :disabled="!canModify"
                :placeholder="$t('ai.pages.studio.llmProviders.form.headers.valuePlaceholder')"
                @input="header.value === HttpRedactedValue && (header.value = '')"
              />
              <UButton
                v-if="canModify"
                color="neutral"
                variant="outline"
                icon="i-lucide-trash-2"
                :aria-label="$t('ai.pages.studio.llmProviders.form.headers.remove')"
                @click="removeHeader(index)"
              />
            </UFieldGroup>
            <UFieldGroup>
              <UButton
                class="flex-1"
                color="neutral"
                variant="outline"
                icon="i-lucide-plus"
                :disabled="!canModify"
                :label="$t('ai.pages.studio.llmProviders.form.headers.add')"
                @click="addHeader"
              />
            </UFieldGroup>
          </div>
        </UFormField>
        <UFormField name="editors" :label="$t('ai.pages.studio.llmProviders.form.editors.label')">
          <SearchMenu
            v-model="state.editors"
            multiple
            class="w-full"
            :icon-fn="getIcon"
            :search-fn="search"
            :label-fn="getLabel"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.llmProviders.form.editors.placeholder')"
          />
        </UFormField>
        <UFormField name="users" :label="$t('ai.pages.studio.llmProviders.form.users.label')">
          <SearchMenu
            v-model="state.users"
            multiple
            class="w-full"
            :icon-fn="getIcon"
            :search-fn="search"
            :label-fn="getLabel"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.llmProviders.form.users.placeholder')"
          />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("ai.pages.studio.llmProviders.form.cancel") }}
          </UButton>
          <UButton type="submit" color="primary" variant="solid" icon="i-lucide-save" :disabled="!canModify">
            {{ $t(`ai.pages.studio.llmProviders.form.${props.id ? "save" : "create"}`) }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
