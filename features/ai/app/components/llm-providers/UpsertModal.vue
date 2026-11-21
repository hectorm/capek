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

import type { RouterInputs, RouterOutputs } from "#layers/core/app/types/trpc";
import type { HttpHeader } from "#layers/core/shared/http";
import { LlmProviderApiTypeSchema } from "#layers/ai/shared/llm-provider";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { useFormTest } from "#layers/core/app/composables/form-test";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { useResourceToast } from "#layers/core/app/composables/resource-toast";
import { useUserStore } from "#layers/core/app/stores/user";
import { creatorAccess, fromPrincipalIds, toOwnerIds, toPrincipalIds } from "#layers/core/app/utils/access";
import { HTTP_REDACTED_VALUE, HttpHeadersSchema, HttpUrlSchema } from "#layers/core/shared/http";

import AccessFields from "#layers/core/app/components/ui/AccessFields.vue";
import ResourceLoadError from "#layers/core/app/components/ui/ResourceLoadError.vue";

type LlmProviderGetOutput = RouterOutputs["ai"]["llmProvider"]["read"];
type LlmProviderCreateInput = RouterInputs["ai"]["llmProvider"]["create"];
type LlmProviderUpdateInput = RouterInputs["ai"]["llmProvider"]["update"];
type LlmProviderCreateOrUpdateInput = LlmProviderCreateInput | LlmProviderUpdateInput;

const props = defineProps<{
  id?: string;
}>();

const emit = defineEmits<{
  close: [{ llmProvider: LlmProviderGetOutput | null }];
}>();

const i18n = useI18n();
const { notify } = useResourceToast("ai.pages.studio.llmProviders");
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();
const userStore = useUserStore();
const { testing, test } = useFormTest({
  success: i18n.t("ai.pages.studio.llmProviders.form.testConnection.success"),
  error: i18n.t("ai.pages.studio.llmProviders.form.testConnection.error"),
});

const loaded = await Promise.all([
  props.id ? $trpc.ai.llmProvider.read.query({ id: props.id }) : Promise.resolve(null),
  props.id ? $trpc.ai.llmProvider.listAccess.query({ llmProviderId: props.id }) : Promise.resolve([]),
]).catch(() => null);
let [llmProvider, currentAccess] = loaded ?? [null, []];

if (!props.id && userStore.user) {
  currentAccess = creatorAccess(userStore.user);
}

const canModify = computed(() => {
  if (!props.id) {
    return can(AiPermissions.LlmProviderCreate);
  }
  return canAny([AiPermissions.LlmProviderUpdateAll, AiPermissions.LlmProviderUpdateOwn], toOwnerIds(currentAccess));
});

const schema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000).trim().default(""),
    apiUrl: HttpUrlSchema,
    apiType: LlmProviderApiTypeSchema,
    apiKey: z.string().max(1000).trim().default(""),
    headers: HttpHeadersSchema.default([]),
    editors: z.array(z.string()).default([]),
    users: z.array(z.string()).default([]),
  })
  .superRefine((data, ctx) => {
    if (!llmProvider || data.apiUrl === llmProvider.apiUrl) {
      return;
    }
    const message = i18n.t("errors.secretRequired");
    if (data.apiKey === HTTP_REDACTED_VALUE) {
      ctx.addIssue({ code: "custom", path: ["apiKey"], message });
    }
    if (data.headers.some((header) => header.value === HTTP_REDACTED_VALUE)) {
      ctx.addIssue({ code: "custom", path: ["headers"], message });
    }
  });

type Schema = z.infer<typeof schema>;

const state = reactive<
  Partial<LlmProviderCreateOrUpdateInput> & {
    id?: string;
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
  ...toPrincipalIds(currentAccess),
});

const apiTypeOptions = [
  { value: "chat-completions", label: i18n.t("ai.pages.studio.llmProviders.form.apiType.chatCompletions") },
  { value: "responses", label: i18n.t("ai.pages.studio.llmProviders.form.apiType.responses") },
  { value: "messages", label: i18n.t("ai.pages.studio.llmProviders.form.apiType.messages") },
];

const onAddHeader = (): void => {
  state.headers.push({ name: "", value: "" });
};

const onRemoveHeader = (index: number): void => {
  state.headers.splice(index, 1);
};

const onSubmit = async (event: FormSubmitEvent<Schema>): Promise<void> => {
  try {
    const access = fromPrincipalIds(event.data);

    if ("id" in event.data && event.data.id) {
      const result = await $trpc.ai.llmProvider.update.mutate({
        id: event.data.id,
        name: event.data.name,
        description: event.data.description,
        apiUrl: event.data.apiUrl,
        apiType: event.data.apiType,
        apiKey: event.data.apiKey,
        headers: event.data.headers,
        access,
      });
      llmProvider = result;
    } else {
      const result = await $trpc.ai.llmProvider.create.mutate({
        name: event.data.name,
        description: event.data.description,
        apiUrl: event.data.apiUrl,
        apiType: event.data.apiType,
        apiKey: event.data.apiKey,
        headers: event.data.headers,
        access,
      });
      llmProvider = result;
      state.id = result.id;
    }

    notify(props.id ? "update" : "create", "success");
    emit("close", { llmProvider });
  } catch {
    notify(props.id ? "update" : "create", "error");
  }
};

const onCancel = (): void => {
  emit("close", { llmProvider: null });
};

const onTestConnection = async (): Promise<void> => {
  if (!state.apiUrl) {
    return;
  }

  await test(
    $trpc.ai.llmProvider.testConnection.mutate({
      id: props.id,
      apiUrl: state.apiUrl,
      apiType: state.apiType,
      apiKey: state.apiKey,
      headers: state.headers,
    }),
  );
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
      <ResourceLoadError v-if="!loaded" @cancel="onCancel" />
      <UForm
        v-else
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
            variant="table"
            :disabled="!canModify"
            :items="apiTypeOptions"
            orientation="horizontal"
            :ui="{ item: 'px-2.5 py-1.25' }"
          />
        </UFormField>
        <UFormField name="apiKey" :label="$t('ai.pages.studio.llmProviders.form.apiKey.label')">
          <UInput
            v-model="state.apiKey"
            class="w-full"
            type="password"
            :disabled="!canModify"
            :placeholder="$t(`ai.pages.studio.llmProviders.form.apiKey.placeholder`)"
            @input="state.apiKey === HTTP_REDACTED_VALUE && (state.apiKey = '')"
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
                @input="header.value === HTTP_REDACTED_VALUE && (header.value = '')"
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
                @input="header.value === HTTP_REDACTED_VALUE && (header.value = '')"
              />
              <UButton
                v-if="canModify"
                color="neutral"
                variant="outline"
                icon="i-lucide-trash-2"
                :aria-label="$t('ai.pages.studio.llmProviders.form.headers.remove')"
                @click="onRemoveHeader(index)"
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
                @click="onAddHeader"
              />
            </UFieldGroup>
          </div>
        </UFormField>
        <AccessFields
          v-model:users="state.users"
          v-model:editors="state.editors"
          :disabled="!canModify"
          :access="currentAccess"
        />
        <div class="flex justify-end gap-2">
          <UButton
            type="button"
            class="mr-auto"
            color="neutral"
            variant="outline"
            :loading="testing"
            icon="i-lucide-plug"
            :disabled="!canModify || !state.apiUrl"
            @click="onTestConnection"
          >
            {{
              testing
                ? $t("ai.pages.studio.llmProviders.form.testConnection.testing")
                : $t("ai.pages.studio.llmProviders.form.testConnection.label")
            }}
          </UButton>
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("ai.pages.studio.llmProviders.form.cancel") }}
          </UButton>
          <UButton
            loading-auto
            type="submit"
            color="primary"
            variant="solid"
            icon="i-lucide-save"
            :disabled="!canModify"
          >
            {{ $t(`ai.pages.studio.llmProviders.form.${props.id ? "save" : "create"}`) }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
