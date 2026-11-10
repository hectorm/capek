<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { z } from "zod/v4";

import type { FormSubmitEvent } from "@nuxt/ui";
import UBadge from "@nuxt/ui/components/Badge.vue";
import UButton from "@nuxt/ui/components/Button.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UFormField from "@nuxt/ui/components/FormField.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UModal from "@nuxt/ui/components/Modal.vue";
import USelect from "@nuxt/ui/components/Select.vue";
import UTextarea from "@nuxt/ui/components/Textarea.vue";
import { useToast } from "@nuxt/ui/composables/useToast";

import type { RouterInputs, RouterOutputs } from "#layers/core/app/types/trpc";
import type { DatasourceAuthType, DatasourceConfig } from "#layers/datasources/shared/datasource";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { usePrincipalSearch } from "#layers/core/app/composables/principal-search";
import { useUserStore } from "#layers/core/app/stores/user";
import { fromPrincipalIds, toPrincipalIds } from "#layers/core/app/utils/access";
import { HttpRedactedValue } from "#layers/core/shared/http";
import { DatasourceConfigSchema } from "#layers/datasources/shared/datasource";
import { DatasourcesPermissions } from "#layers/datasources/shared/rbac";
import { DatasourceTypes } from "#layers/datasources/shared/definitions";

import SearchMenu from "#layers/core/app/components/ui/SearchMenu.vue";

type DatasourceGetOutput = RouterOutputs["datasources"]["source"]["read"];
type DatasourceCreateInput = RouterInputs["datasources"]["source"]["create"];
type DatasourceUpdateInput = RouterInputs["datasources"]["source"]["update"];
type DatasourceCreateOrUpdateInput = DatasourceCreateInput | DatasourceUpdateInput;

const props = defineProps<{
  id?: string | null;
}>();

const emit = defineEmits<{
  close: [{ datasource: DatasourceGetOutput | null; error: Error | null }];
}>();

const i18n = useI18n();
const toast = useToast();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();
const { search, getLabel, getIcon, preload } = usePrincipalSearch();
const userStore = useUserStore();

let [datasource, currentAccess] = await Promise.all([
  props.id ? $trpc.datasources.source.read.query({ id: props.id }) : Promise.resolve(null),
  props.id ? $trpc.datasources.source.listAccess.query({ sourceId: props.id }) : Promise.resolve([]),
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
    return can(DatasourcesPermissions.SourceCreate);
  }
  const principalIds = currentAccess.filter((a) => a.role === "editor").map((a) => a.id);
  return canAny([DatasourcesPermissions.SourceUpdateAll, DatasourcesPermissions.SourceUpdateOwn], principalIds);
});

// The configuration is validated with the schema of the selected type of datasource
const schema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().min(1).max(100).trim(),
    description: z.string().max(1000).trim().default(""),
    documentation: z.string().max(100000).trim().optional(),
    editors: z.array(z.string()).default([]),
    users: z.array(z.string()).default([]),
    type: z.string().min(1),
    config: DatasourceConfigSchema,
  })
  .superRefine((data, ctx) => {
    const type = DatasourceTypes.find((candidate) => candidate.type === data.type);
    if (!type) {
      ctx.addIssue({
        code: "custom",
        path: ["type"],
        message: i18n.t("datasources.pages.studio.datasources.form.type.unsupported"),
      });
      return;
    }
    const parsed = type.configSchema.safeParse(data.config);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: "custom", path: ["config", ...issue.path], message: issue.message });
      }
    }
  });

type Schema = z.infer<typeof schema>;

const editorIds = toPrincipalIds(currentAccess, "editor");
const userIds = toPrincipalIds(currentAccess, "user");

preload(currentAccess);

const initialType = datasource?.type ?? DatasourceTypes[0]?.type ?? "";
const storedConfig = datasource?.config ?? {};
const initialAuthType =
  storedConfig.authType ?? DatasourceTypes.find((type) => type.type === initialType)?.authTypes[0] ?? "none";

const state = reactive<
  Partial<DatasourceCreateOrUpdateInput> & {
    id?: string;
    documentation?: string;
    type: string;
    config: DatasourceConfig;
    editors: string[];
    users: string[];
  }
>({
  id: datasource?.id,
  name: datasource?.name,
  description: datasource?.description,
  documentation: datasource?.documentation ?? undefined,
  type: initialType,
  config: { ...storedConfig, authType: initialAuthType },
  editors: editorIds,
  users: userIds,
});

// Undefined when the type of the datasource is no longer supported
const definition = computed(() => DatasourceTypes.find((type) => type.type === state.type));

const typeOptions = DatasourceTypes.map((type) => ({
  label: type.label,
  value: type.type,
}));

const authTypeOptions = computed(() => {
  return (definition.value?.authTypes ?? []).map((t) => ({
    label: i18n.t(`datasources.pages.studio.datasources.form.authType.options.${t}`),
    value: t,
  }));
});

const useConfigField = <T,>(key: string, def: T) => {
  return computed<T>({
    get: () => (state.config[key] as T | undefined) ?? def,
    set: (v) => (state.config = { ...state.config, [key]: v }),
  });
};

const authType = useConfigField<DatasourceAuthType>("authType", definition.value?.authTypes[0] ?? "none");
const connectionString = useConfigField<string>("connectionString", "");
const username = useConfigField<string>("username", "");
const password = useConfigField<string>("password", "");
const azureTenantId = useConfigField<string>("azureTenantId", "");
const azureClientId = useConfigField<string>("azureClientId", "");
const azureClientSecret = useConfigField<string>("azureClientSecret", "");

watch(
  () => state.type,
  () => {
    const allowed = definition.value?.authTypes ?? [];
    if (!allowed.includes(authType.value)) {
      authType.value = allowed[0] ?? "none";
    }
  },
);

const onSubmit = async (event: FormSubmitEvent<Schema>) => {
  try {
    let datasourceId: string;

    if ("id" in event.data && event.data.id) {
      const result = await $trpc.datasources.source.update.mutate({
        id: event.data.id,
        name: event.data.name,
        description: event.data.description,
        documentation: event.data.documentation,
        type: event.data.type,
        config: event.data.config,
      });
      datasource = result;
      datasourceId = result.id;
    } else {
      const result = await $trpc.datasources.source.create.mutate({
        name: event.data.name,
        description: event.data.description,
        documentation: event.data.documentation,
        type: event.data.type,
        config: event.data.config,
      });
      datasource = result;
      datasourceId = result.id;
    }

    const access = fromPrincipalIds(event.data);
    await $trpc.datasources.source.syncAccess.mutate({ sourceId: datasourceId, access });

    emit("close", { datasource, error: null });
  } catch {
    const action = props.id ? "update" : "create";
    toast.add({
      color: "error",
      title: i18n.t(`datasources.pages.studio.datasources.table.actions.${action}.error.title`),
      description: i18n.t(`datasources.pages.studio.datasources.table.actions.${action}.error.description`),
    });
  }
};

const onCancel = () => {
  emit("close", { datasource: null, error: null });
};

const testing = ref(false);
const testResult = ref<{ success: true } | { success: false; error: string } | null>(null);

const onTestConnection = async () => {
  testing.value = true;
  testResult.value = null;

  try {
    testResult.value = await $trpc.datasources.source.testConnection.mutate({
      id: state.id,
      type: state.type,
      config: state.config,
    });
  } catch (error) {
    testResult.value = { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    testing.value = false;
  }
};
</script>

<template>
  <UModal
    :close="false"
    :dismissible="false"
    :title="$t(`datasources.pages.studio.datasources.${props.id ? 'edit' : 'create'}.title`)"
    :description="$t(`datasources.pages.studio.datasources.${props.id ? 'edit' : 'create'}.description`)"
  >
    <template #body>
      <UForm
        :state="state"
        :schema="schema"
        :validate-on="['change']"
        class="w-full max-w-150 space-y-4"
        @submit="onSubmit"
      >
        <UFormField required name="name" :label="$t('datasources.pages.studio.datasources.form.name.label')">
          <UInput
            v-model="state.name"
            type="text"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('datasources.pages.studio.datasources.form.name.placeholder')"
          />
        </UFormField>
        <UFormField name="description" :label="$t('datasources.pages.studio.datasources.form.description.label')">
          <UTextarea
            v-model="state.description"
            autoresize
            :maxrows="3"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('datasources.pages.studio.datasources.form.description.placeholder')"
          />
        </UFormField>
        <UFormField name="documentation" :label="$t('datasources.pages.studio.datasources.form.documentation.label')">
          <UTextarea
            v-model="state.documentation"
            autoresize
            :minrows="5"
            :maxrows="15"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('datasources.pages.studio.datasources.form.documentation.placeholder')"
          />
        </UFormField>
        <UFormField required name="type" :label="$t('datasources.pages.studio.datasources.form.type.label')">
          <USelect
            v-model="state.type"
            class="w-full"
            :items="typeOptions"
            :disabled="!canModify"
            :placeholder="$t('datasources.pages.studio.datasources.form.type.placeholder')"
          />
        </UFormField>
        <UFormField
          required
          name="config.connectionString"
          :label="$t('datasources.pages.studio.datasources.form.connectionString.label')"
        >
          <UInput
            v-model="connectionString"
            type="text"
            class="w-full"
            :disabled="!canModify"
            :placeholder="definition?.placeholder"
          />
        </UFormField>
        <UFormField
          required
          name="config.authType"
          :label="$t('datasources.pages.studio.datasources.form.authType.label')"
        >
          <USelect
            v-model="authType"
            class="w-full"
            :disabled="!canModify"
            :items="authTypeOptions"
            :placeholder="$t('datasources.pages.studio.datasources.form.authType.placeholder')"
          />
        </UFormField>
        <template v-if="authType === 'basic'">
          <UFormField name="config.username" :label="$t('datasources.pages.studio.datasources.form.username.label')">
            <UInput
              v-model="username"
              type="text"
              class="w-full"
              :disabled="!canModify"
              :placeholder="$t('datasources.pages.studio.datasources.form.username.placeholder')"
            />
          </UFormField>
          <UFormField name="config.password" :label="$t('datasources.pages.studio.datasources.form.password.label')">
            <UInput
              v-model="password"
              class="w-full"
              type="password"
              :disabled="!canModify"
              :placeholder="$t('datasources.pages.studio.datasources.form.password.placeholder')"
              @input="password === HttpRedactedValue && (password = '')"
            />
          </UFormField>
        </template>
        <template v-else-if="authType === 'azure-service-principal'">
          <UFormField
            name="config.azureTenantId"
            :label="$t('datasources.pages.studio.datasources.form.azureTenantId.label')"
          >
            <UInput
              v-model="azureTenantId"
              type="text"
              class="w-full"
              :disabled="!canModify"
              :placeholder="$t('datasources.pages.studio.datasources.form.azureTenantId.placeholder')"
            />
          </UFormField>
          <UFormField
            name="config.azureClientId"
            :label="$t('datasources.pages.studio.datasources.form.azureClientId.label')"
          >
            <UInput
              v-model="azureClientId"
              type="text"
              class="w-full"
              :disabled="!canModify"
              :placeholder="$t('datasources.pages.studio.datasources.form.azureClientId.placeholder')"
            />
          </UFormField>
          <UFormField
            name="config.azureClientSecret"
            :label="$t('datasources.pages.studio.datasources.form.azureClientSecret.label')"
          >
            <UInput
              v-model="azureClientSecret"
              class="w-full"
              type="password"
              :disabled="!canModify"
              :placeholder="$t('datasources.pages.studio.datasources.form.azureClientSecret.placeholder')"
              @input="azureClientSecret === HttpRedactedValue && (azureClientSecret = '')"
            />
          </UFormField>
        </template>
        <template v-else-if="authType === 'azure-managed-identity'">
          <UFormField
            name="config.azureClientId"
            :label="$t('datasources.pages.studio.datasources.form.azureClientId.label')"
          >
            <UInput
              v-model="azureClientId"
              type="text"
              class="w-full"
              :disabled="!canModify"
              :placeholder="$t('datasources.pages.studio.datasources.form.azureClientId.placeholder')"
            />
          </UFormField>
        </template>
        <div class="flex flex-col items-start gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            :loading="testing"
            icon="i-lucide-plug"
            @click="onTestConnection"
          >
            {{
              testing
                ? $t("datasources.pages.studio.datasources.form.testConnection.testing")
                : $t("datasources.pages.studio.datasources.form.testConnection.label")
            }}
          </UButton>
          <UBadge v-if="testResult?.success" color="success" variant="subtle" icon="i-lucide-check-circle">
            {{ $t("datasources.pages.studio.datasources.form.testConnection.success") }}
          </UBadge>
          <UBadge
            v-else-if="testResult && !testResult.success"
            color="error"
            variant="subtle"
            class="items-start"
            icon="i-lucide-x-circle"
          >
            <span class="wrap-break-word whitespace-normal">
              {{ $t("datasources.pages.studio.datasources.form.testConnection.error", { error: testResult.error }) }}
            </span>
          </UBadge>
        </div>
        <UFormField name="editors" :label="$t('datasources.pages.studio.datasources.form.editors.label')">
          <SearchMenu
            v-model="state.editors"
            multiple
            class="w-full"
            :icon-fn="getIcon"
            :search-fn="search"
            :label-fn="getLabel"
            :disabled="!canModify"
            :placeholder="$t('datasources.pages.studio.datasources.form.editors.placeholder')"
          />
        </UFormField>
        <UFormField name="users" :label="$t('datasources.pages.studio.datasources.form.users.label')">
          <SearchMenu
            v-model="state.users"
            multiple
            class="w-full"
            :icon-fn="getIcon"
            :search-fn="search"
            :label-fn="getLabel"
            :disabled="!canModify"
            :placeholder="$t('datasources.pages.studio.datasources.form.users.placeholder')"
          />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("datasources.pages.studio.datasources.form.cancel") }}
          </UButton>
          <UButton type="submit" color="primary" variant="solid" icon="i-lucide-save" :disabled="!canModify">
            {{ $t(`datasources.pages.studio.datasources.form.${props.id ? "save" : "create"}`) }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
