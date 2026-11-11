<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";
import { computed, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { z } from "zod/v4";

import type { AccordionItem, FormSubmitEvent } from "@nuxt/ui";
import UAccordion from "@nuxt/ui/components/Accordion.vue";
import UBadge from "@nuxt/ui/components/Badge.vue";
import UButton from "@nuxt/ui/components/Button.vue";
import UFieldGroup from "@nuxt/ui/components/FieldGroup.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UFormField from "@nuxt/ui/components/FormField.vue";
import UIcon from "@nuxt/ui/components/Icon.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UModal from "@nuxt/ui/components/Modal.vue";
import USwitch from "@nuxt/ui/components/Switch.vue";
import UTextarea from "@nuxt/ui/components/Textarea.vue";
import { useToast } from "@nuxt/ui/composables/useToast";

import type { RouterInputs, RouterOutputs } from "#layers/core/app/types/trpc";
import type { HttpHeader } from "#layers/core/shared/http";
import { useFormTest } from "#layers/core/app/composables/form-test";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { usePrincipalSearch } from "#layers/core/app/composables/principal-search";
import { fromPrincipalIds, toPrincipalIds } from "#layers/core/app/utils/access";
import { useUserStore } from "#layers/core/app/stores/user";
import { HttpHeadersSchema, HttpRedactedValue } from "#layers/core/shared/http";
import { MCPServerParameters, MCPServerParametersSchema } from "#layers/ai/shared/mcp";
import { AiPermissions } from "#layers/ai/shared/rbac";

import NumberParameterField from "#layers/core/app/components/ui/NumberParameterField.vue";
import SearchMenu from "#layers/core/app/components/ui/SearchMenu.vue";

type McpServerGetOutput = RouterOutputs["ai"]["mcpServer"]["read"];
type McpServerCreateInput = RouterInputs["ai"]["mcpServer"]["create"];
type McpServerUpdateInput = RouterInputs["ai"]["mcpServer"]["update"];
type McpServerCreateOrUpdateInput = McpServerCreateInput | McpServerUpdateInput;

const props = defineProps<{
  id?: string | null;
}>();

const emit = defineEmits<{
  close: [{ mcpServer: McpServerGetOutput | null; error: Error | null }];
}>();

const i18n = useI18n();
const toast = useToast();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();
const { search, getLabel, getIcon, preload } = usePrincipalSearch();
const userStore = useUserStore();

let [mcpServer, currentAccess] = await Promise.all([
  props.id ? $trpc.ai.mcpServer.read.query({ id: props.id }) : Promise.resolve(null),
  props.id ? $trpc.ai.mcpServer.listAccess.query({ mcpServerId: props.id }) : Promise.resolve([]),
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
    return can(AiPermissions.McpServerCreate);
  }
  const principalIds = currentAccess.filter((a) => a.role === "editor").map((a) => a.id);
  return canAny([AiPermissions.McpServerUpdateAll, AiPermissions.McpServerUpdateOwn], principalIds);
});

const schema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().min(1).max(100).trim(),
    description: z.string().max(1000).trim().default(""),
    url: z.url(),
    headers: HttpHeadersSchema.default([]),
    stateful: z.boolean().default(false),
    editors: z.array(z.string()).default([]),
    users: z.array(z.string()).default([]),
  })
  .extend(MCPServerParametersSchema.shape);

type Schema = z.infer<typeof schema>;

const editorIds = toPrincipalIds(currentAccess, "editor");
const userIds = toPrincipalIds(currentAccess, "user");

preload(currentAccess);

const state = reactive<
  Partial<McpServerCreateOrUpdateInput> & {
    headers: HttpHeader[];
    stateful: boolean;
    editors: string[];
    users: string[];
  }
>({
  id: mcpServer?.id,
  name: mcpServer?.name,
  description: mcpServer?.description,
  url: mcpServer?.url,
  headers: mcpServer?.headers ?? [],
  stateful: mcpServer?.stateful ?? false,
  toolCallTimeoutSec: mcpServer?.toolCallTimeoutSec,
  editors: editorIds,
  users: userIds,
});

const advancedSettingsEntries = Object.entries(MCPServerParameters) as [
  keyof typeof MCPServerParameters,
  (typeof MCPServerParameters)[keyof typeof MCPServerParameters],
][];

const advancedSettingsItems = computed<AccordionItem[]>(() => [
  {
    label: i18n.t("ai.pages.studio.mcpServers.form.advancedSettings.label"),
    slot: "advanced" as const,
  },
]);

const advancedSettingsCount = computed(() => advancedSettingsEntries.filter(([key]) => state[key] != null).length);

const addHeader = () => {
  state.headers.push({ name: "", value: "" });
};

const removeHeader = (index: number) => {
  state.headers.splice(index, 1);
};

const onSubmit = async (event: FormSubmitEvent<Schema>) => {
  try {
    let mcpServerId: string;

    if ("id" in event.data && event.data.id) {
      const result = await $trpc.ai.mcpServer.update.mutate({
        id: event.data.id,
        name: event.data.name,
        description: event.data.description,
        url: event.data.url,
        headers: event.data.headers,
        stateful: event.data.stateful,
        toolCallTimeoutSec: event.data.toolCallTimeoutSec,
      });
      mcpServer = result;
      mcpServerId = result.id;
    } else {
      const result = await $trpc.ai.mcpServer.create.mutate({
        name: event.data.name,
        description: event.data.description,
        url: event.data.url,
        headers: event.data.headers,
        stateful: event.data.stateful,
        toolCallTimeoutSec: event.data.toolCallTimeoutSec,
      });
      mcpServer = result;
      mcpServerId = result.id;
    }

    const access = fromPrincipalIds(event.data);
    await $trpc.ai.mcpServer.syncAccess.mutate({ mcpServerId, access });

    emit("close", { mcpServer, error: null });
  } catch {
    const action = props.id ? "update" : "create";
    toast.add({
      color: "error",
      title: i18n.t(`ai.pages.studio.mcpServers.table.actions.${action}.error.title`),
      description: i18n.t(`ai.pages.studio.mcpServers.table.actions.${action}.error.description`),
    });
  }
};

const onCancel = () => {
  emit("close", { mcpServer: null, error: null });
};

const { testing, test } = useFormTest({
  success: i18n.t("ai.pages.studio.mcpServers.form.testConnection.success"),
  error: i18n.t("ai.pages.studio.mcpServers.form.testConnection.error"),
});

const onTestConnection = async () => {
  if (!state.url) return;

  await test(
    $trpc.ai.mcpServer.testConnection.mutate({
      id: props.id ?? undefined,
      url: state.url,
      headers: state.headers,
    }),
  );
};
</script>

<template>
  <UModal
    :close="false"
    :dismissible="false"
    :title="$t(`ai.pages.studio.mcpServers.${props.id ? 'edit' : 'create'}.title`)"
    :description="$t(`ai.pages.studio.mcpServers.${props.id ? 'edit' : 'create'}.description`)"
  >
    <template #body>
      <UForm
        :state="state"
        :schema="schema"
        :validate-on="['change']"
        class="w-full max-w-150 space-y-4"
        @submit="onSubmit"
      >
        <UFormField required name="name" :label="$t('ai.pages.studio.mcpServers.form.name.label')">
          <UInput
            v-model="state.name"
            type="text"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.mcpServers.form.name.placeholder')"
          />
        </UFormField>
        <UFormField name="description" :label="$t('ai.pages.studio.mcpServers.form.description.label')">
          <UTextarea
            v-model="state.description"
            autoresize
            :maxrows="3"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.mcpServers.form.description.placeholder')"
          />
        </UFormField>
        <UFormField required name="url" :label="$t('ai.pages.studio.mcpServers.form.url.label')">
          <UInput
            v-model="state.url"
            type="url"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.mcpServers.form.url.placeholder')"
          />
        </UFormField>
        <UFormField name="headers" :label="$t('ai.pages.studio.mcpServers.form.headers.label')">
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
                :placeholder="$t('ai.pages.studio.mcpServers.form.headers.namePlaceholder')"
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
                :placeholder="$t('ai.pages.studio.mcpServers.form.headers.valuePlaceholder')"
                @input="header.value === HttpRedactedValue && (header.value = '')"
              />
              <UButton
                v-if="canModify"
                color="neutral"
                variant="outline"
                icon="i-lucide-trash-2"
                :aria-label="$t('ai.pages.studio.mcpServers.form.headers.remove')"
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
                :label="$t('ai.pages.studio.mcpServers.form.headers.add')"
                @click="addHeader"
              />
            </UFieldGroup>
          </div>
        </UFormField>
        <UFormField name="stateful" :label="$t('ai.pages.studio.mcpServers.form.stateful.label')">
          <USwitch
            v-model="state.stateful"
            :disabled="!canModify"
            :description="$t('ai.pages.studio.mcpServers.form.stateful.description')"
          />
        </UFormField>
        <UFormField name="editors" :label="$t('ai.pages.studio.mcpServers.form.editors.label')">
          <SearchMenu
            v-model="state.editors"
            multiple
            class="w-full"
            :icon-fn="getIcon"
            :search-fn="search"
            :label-fn="getLabel"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.mcpServers.form.editors.placeholder')"
          />
        </UFormField>
        <UFormField name="users" :label="$t('ai.pages.studio.mcpServers.form.users.label')">
          <SearchMenu
            v-model="state.users"
            multiple
            class="w-full"
            :icon-fn="getIcon"
            :search-fn="search"
            :label-fn="getLabel"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.mcpServers.form.users.placeholder')"
          />
        </UFormField>
        <UAccordion :ui="{ trigger: 'pt-0' }" :items="advancedSettingsItems">
          <template #leading>
            <UIcon class="size-5" name="i-lucide-settings-2" />
          </template>
          <template #trailing="{ open }">
            <UBadge v-if="advancedSettingsCount > 0" size="sm" color="primary" variant="subtle">
              {{ $t("ai.pages.studio.mcpServers.form.advancedSettings.customized", { count: advancedSettingsCount }) }}
            </UBadge>
            <div class="flex flex-1 justify-end">
              <UIcon class="size-5 text-muted" :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" />
            </div>
          </template>
          <template #advanced>
            <div class="space-y-4 pb-4">
              <UFormField
                v-for="[key, params] in advancedSettingsEntries"
                :key="key"
                :name="key"
                :label="$t(`ai.pages.studio.mcpServers.form.${key}.label`)"
                :description="$t(`ai.pages.studio.mcpServers.form.${key}.hint`)"
              >
                <NumberParameterField
                  :max="params.max"
                  :min="params.min"
                  :step="params.step"
                  :disabled="!canModify"
                  :default="params.default"
                  :model-value="state[key]"
                  :default-hint="
                    $t('ai.pages.studio.mcpServers.form.advancedSettings.default', { value: params.default })
                  "
                  @update:model-value="(v) => (state[key] = v)"
                />
              </UFormField>
            </div>
          </template>
        </UAccordion>
        <div class="flex justify-end gap-2">
          <UButton
            type="button"
            class="mr-auto"
            color="neutral"
            variant="outline"
            :loading="testing"
            icon="i-lucide-plug"
            :disabled="!canModify || !state.url"
            @click="onTestConnection"
          >
            {{
              testing
                ? $t("ai.pages.studio.mcpServers.form.testConnection.testing")
                : $t("ai.pages.studio.mcpServers.form.testConnection.label")
            }}
          </UButton>
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("ai.pages.studio.mcpServers.form.cancel") }}
          </UButton>
          <UButton type="submit" color="primary" variant="solid" icon="i-lucide-save" :disabled="!canModify">
            {{ $t(`ai.pages.studio.mcpServers.form.${props.id ? "save" : "create"}`) }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
