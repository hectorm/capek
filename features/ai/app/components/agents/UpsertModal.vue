<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";
import { computed, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import { z } from "zod/v4";

import type { AccordionItem, FormSubmitEvent } from "@nuxt/ui";
import UAccordion from "@nuxt/ui/components/Accordion.vue";
import UBadge from "@nuxt/ui/components/Badge.vue";
import UButton from "@nuxt/ui/components/Button.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UFormField from "@nuxt/ui/components/FormField.vue";
import UIcon from "@nuxt/ui/components/Icon.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UInputMenu from "@nuxt/ui/components/InputMenu.vue";
import UModal from "@nuxt/ui/components/Modal.vue";
import URadioGroup from "@nuxt/ui/components/RadioGroup.vue";
import USwitch from "@nuxt/ui/components/Switch.vue";
import UTextarea from "@nuxt/ui/components/Textarea.vue";
import { useToast } from "@nuxt/ui/composables/useToast";

import type { RouterInputs, RouterOutputs } from "#layers/core/app/types/trpc";
import { useFormTest } from "#layers/core/app/composables/form-test";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { usePrincipalSearch } from "#layers/core/app/composables/principal-search";
import { fromPrincipalIds, toPrincipalIds } from "#layers/core/app/utils/access";
import { useUserStore } from "#layers/core/app/stores/user";
import { AgentExecutorParameters, AgentExecutorParametersSchema } from "#layers/ai/shared/agent";
import { AiPermissions } from "#layers/ai/shared/rbac";

import NumberParameterField from "#layers/core/app/components/ui/NumberParameterField.vue";
import SearchMenu from "#layers/core/app/components/ui/SearchMenu.vue";

type AgentGetOutput = RouterOutputs["ai"]["agent"]["read"];
type AgentCreateInput = RouterInputs["ai"]["agent"]["create"];
type AgentUpdateInput = RouterInputs["ai"]["agent"]["update"];
type AgentCreateOrUpdateInput = AgentCreateInput | AgentUpdateInput;

const props = defineProps<{
  id?: string | null;
}>();

const emit = defineEmits<{
  close: [{ agent: AgentGetOutput | null; error: Error | null }];
}>();

const i18n = useI18n();
const toast = useToast();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();
const { search, getLabel, getIcon, preload } = usePrincipalSearch();
const userStore = useUserStore();

let [agent, currentAccess, currentMcpServers, currentSkills, currentSpecialists] = await Promise.all([
  props.id ? $trpc.ai.agent.read.query({ id: props.id }) : Promise.resolve(null),
  props.id ? $trpc.ai.agent.listAccess.query({ agentId: props.id }) : Promise.resolve([]),
  props.id ? $trpc.ai.agent.listMcpServers.query({ agentId: props.id }) : Promise.resolve([]),
  props.id ? $trpc.ai.agent.listSkills.query({ agentId: props.id }) : Promise.resolve([]),
  props.id ? $trpc.ai.agent.listSpecialists.query({ triageAgentId: props.id }) : Promise.resolve([]),
]);

const [toolProviders, currentToolResources] = await Promise.all([
  $trpc.ai.agent.listToolProviders.query(),
  props.id ? $trpc.ai.agent.listToolResources.query({ agentId: props.id }) : Promise.resolve([]),
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
    return can(AiPermissions.AgentCreate);
  }
  const principalIds = currentAccess.filter((a) => a.role === "editor").map((a) => a.id);
  return canAny([AiPermissions.AgentUpdateAll, AiPermissions.AgentUpdateOwn], principalIds);
});

const schema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().min(1).max(100).trim(),
    description: z.string().max(1000).trim().default(""),
    instructions: z.string().max(100000).trim().default(""),
    greetingMessage: z.string().max(10000).trim().default(""),
    editors: z.array(z.string()).default([]),
    users: z.array(z.string()).default([]),
    type: z.enum(["triage", "specialist"]),
    specialists: z.array(z.string()).default([]),
    llmProviderId: z.uuid().nullable(),
    model: z.string().min(1).max(100).trim(),
    summaryModel: z.string().max(100).trim().default(""),
    reasoningEffort: z.string().max(20).trim().default(""),
    mcpServers: z.array(z.string()).default([]),
    skills: z.array(z.string()).default([]),
    codeInterpreter: z.boolean().default(false),
    streaming: z.boolean().default(true),
  })
  .extend(AgentExecutorParametersSchema.shape);

type Schema = z.infer<typeof schema>;

const editorIds = toPrincipalIds(currentAccess, "editor");
const userIds = toPrincipalIds(currentAccess, "user");

preload(currentAccess);

const state = reactive<
  Partial<AgentCreateOrUpdateInput> & {
    editors: string[];
    users: string[];
    type?: "triage" | "specialist";
    specialists: string[];
    mcpServers: string[];
    skills: string[];
    codeInterpreter: boolean;
    streaming: boolean;
  }
>({
  id: agent?.id,
  name: agent?.name,
  description: agent?.description,
  instructions: agent?.instructions,
  greetingMessage: agent?.greetingMessage,
  editors: editorIds,
  users: userIds,
  type: agent?.type ?? "specialist",
  specialists: currentSpecialists.map((s) => s.id),
  llmProviderId: agent?.llmProviderId ?? null,
  model: agent?.model,
  summaryModel: agent?.summaryModel,
  reasoningEffort: agent?.reasoningEffort,
  mcpServers: currentMcpServers.map((m) => m.id),
  skills: currentSkills.map((a) => a.id),
  codeInterpreter: agent?.codeInterpreter ?? false,
  streaming: agent?.streaming ?? true,
  temperature: agent?.temperature,
  maxTokens: agent?.maxTokens,
  topP: agent?.topP,
  frequencyPenalty: agent?.frequencyPenalty,
  presencePenalty: agent?.presencePenalty,
  maxIterations: agent?.maxIterations,
  timeoutSec: agent?.timeoutSec,
  maxContextChars: agent?.maxContextChars,
  maxToolResponseChars: agent?.maxToolResponseChars,
});

const selectedLlmProviderId = computed({
  get: () => state.llmProviderId ?? undefined,
  set: (value: string | undefined) => {
    state.llmProviderId = value ?? null;
  },
});

const typeOptions = [
  { value: "specialist", label: i18n.t("ai.pages.studio.agents.form.type.specialist") },
  { value: "triage", label: i18n.t("ai.pages.studio.agents.form.type.triage") },
];

const reasoningEffortOptions = ["none", "low", "medium", "high", "xhigh"];

const llmProviderLabels = new Map<string, string>();
if (agent?.llmProviderId && agent.llmProviderName) {
  llmProviderLabels.set(agent.llmProviderId, agent.llmProviderName);
}
const searchLlmProviders = async (query?: string) => {
  const result = await $trpc.ai.llmProvider.search.query({ search: query, limit: 25 });
  result.llmProviders.forEach((provider) => {
    llmProviderLabels.set(provider.id, provider.name);
  });
  return result.llmProviders.map((provider) => provider.id);
};
const getLlmProviderLabel = (id: string) => {
  return llmProviderLabels.get(id) ?? id;
};

const mcpServerLabels = new Map(currentMcpServers.map((server) => [server.id, server.name]));
const searchMcpServers = async (query?: string) => {
  const result = await $trpc.ai.mcpServer.search.query({ search: query, limit: 25 });
  result.mcpServers.forEach((server) => {
    mcpServerLabels.set(server.id, server.name);
  });
  return result.mcpServers.map((server) => server.id);
};
const getMcpServerLabel = (id: string) => {
  return mcpServerLabels.get(id) ?? id;
};

const skillLabels = new Map(currentSkills.map((skill) => [skill.id, skill.name]));
const searchSkills = async (query?: string) => {
  const result = await $trpc.ai.skill.search.query({ search: query, limit: 25 });
  result.skills.forEach((skill) => {
    skillLabels.set(skill.id, skill.name);
  });
  return result.skills.map((skill) => skill.id);
};
const getSkillLabel = (id: string) => {
  return skillLabels.get(id) ?? id;
};

const assignableToolProviders = toolProviders.filter((provider) => provider.assignable);
const switchableToolProviders = toolProviders.filter((provider) => !provider.assignable);

const enabledToolProviders = reactive<Record<string, boolean>>(
  Object.fromEntries(
    switchableToolProviders.map((provider) => [provider.name, agent?.toolProviders.includes(provider.name) ?? false]),
  ),
);
const getEnabledToolProviders = (): string[] => {
  return switchableToolProviders
    .filter((provider) => enabledToolProviders[provider.name])
    .map((provider) => provider.name);
};

const toolResources = reactive<Record<string, string[]>>(
  Object.fromEntries(
    assignableToolProviders.map((provider) => [
      provider.name,
      currentToolResources.filter((resource) => resource.provider === provider.name).map((resource) => resource.id),
    ]),
  ),
);
const toolResourceLabels = new Map(currentToolResources.map((resource) => [resource.id, resource.name]));
const searchToolResources = async (provider: string, query?: string) => {
  const resources = await $trpc.ai.agent.searchToolResources.query({ provider, search: query, limit: 25 });
  resources.forEach((resource) => {
    toolResourceLabels.set(resource.id, resource.name);
  });
  return resources.map((resource) => resource.id);
};
const getToolResourceLabel = (id: string) => {
  return toolResourceLabels.get(id) ?? id;
};

const specialistLabels = new Map(currentSpecialists.map((specialist) => [specialist.id, specialist.name]));
const searchSpecialists = async (query?: string) => {
  const result = await $trpc.ai.agent.search.query({ search: query, type: "specialist", limit: 25 });
  result.agents.forEach((specialist) => {
    specialistLabels.set(specialist.id, specialist.name);
  });
  return result.agents.map((specialist) => specialist.id);
};
const getSpecialistLabel = (id: string) => {
  return specialistLabels.get(id) ?? id;
};

const advancedSettingsEntries = Object.entries(AgentExecutorParameters) as [
  keyof typeof AgentExecutorParameters,
  (typeof AgentExecutorParameters)[keyof typeof AgentExecutorParameters],
][];

const advancedSettingsItems = computed<AccordionItem[]>(() => [
  {
    label: i18n.t("ai.pages.studio.agents.form.advancedSettings.label"),
    slot: "advanced" as const,
  },
]);

const advancedSettingsCount = computed(() => advancedSettingsEntries.filter(([key]) => state[key] != null).length);

watch(
  () => (state as { type?: string }).type,
  (newType) => {
    if (newType === "specialist") {
      state.specialists = [];
    }
  },
);

const onSubmit = async (event: FormSubmitEvent<Schema>) => {
  try {
    let agentId: string;

    if ("id" in event.data && event.data.id) {
      const result = await $trpc.ai.agent.update.mutate({
        id: event.data.id,
        name: event.data.name,
        description: event.data.description,
        instructions: event.data.instructions,
        greetingMessage: event.data.greetingMessage,
        llmProviderId: event.data.llmProviderId,
        model: event.data.model,
        summaryModel: event.data.summaryModel,
        reasoningEffort: event.data.reasoningEffort,
        codeInterpreter: event.data.type === "specialist" ? event.data.codeInterpreter : false,
        toolProviders: event.data.type === "specialist" ? getEnabledToolProviders() : [],
        streaming: event.data.streaming,
        temperature: event.data.temperature,
        maxTokens: event.data.maxTokens,
        topP: event.data.topP,
        frequencyPenalty: event.data.frequencyPenalty,
        presencePenalty: event.data.presencePenalty,
        maxIterations: event.data.maxIterations,
        timeoutSec: event.data.timeoutSec,
        maxContextChars: event.data.maxContextChars,
        maxToolResponseChars: event.data.maxToolResponseChars,
      });
      agent = result;
      agentId = result.id;
    } else {
      const result = await $trpc.ai.agent.create.mutate({
        name: event.data.name,
        description: event.data.description,
        instructions: event.data.instructions,
        greetingMessage: event.data.greetingMessage,
        type: event.data.type,
        llmProviderId: event.data.llmProviderId,
        model: event.data.model,
        summaryModel: event.data.summaryModel,
        reasoningEffort: event.data.reasoningEffort,
        codeInterpreter: event.data.codeInterpreter,
        toolProviders: getEnabledToolProviders(),
        streaming: event.data.streaming,
        temperature: event.data.temperature,
        maxTokens: event.data.maxTokens,
        topP: event.data.topP,
        frequencyPenalty: event.data.frequencyPenalty,
        presencePenalty: event.data.presencePenalty,
        maxIterations: event.data.maxIterations,
        timeoutSec: event.data.timeoutSec,
        maxContextChars: event.data.maxContextChars,
        maxToolResponseChars: event.data.maxToolResponseChars,
      });
      agent = result;
      agentId = result.id;
    }

    const access = fromPrincipalIds(event.data);

    await Promise.all([
      $trpc.ai.agent.syncMcpServers.mutate({ agentId, mcpServerIds: event.data.mcpServers }),
      $trpc.ai.agent.syncSkills.mutate({ agentId, skillIds: event.data.skills }),
      ...assignableToolProviders.map((provider) =>
        $trpc.ai.agent.syncToolResources.mutate({
          agentId,
          provider: provider.name,
          resourceIds: toolResources[provider.name] ?? [],
        }),
      ),
      $trpc.ai.agent.syncSpecialists.mutate({ triageAgentId: agentId, specialistIds: event.data.specialists }),
      $trpc.ai.agent.syncAccess.mutate({ agentId, access }),
    ]);

    emit("close", { agent, error: null });
  } catch {
    const action = props.id ? "update" : "create";
    toast.add({
      color: "error",
      title: i18n.t(`ai.pages.studio.agents.table.actions.${action}.error.title`),
      description: i18n.t(`ai.pages.studio.agents.table.actions.${action}.error.description`),
    });
  }
};

const onCancel = () => {
  emit("close", { agent: null, error: null });
};

const { testing, test } = useFormTest({
  success: i18n.t("ai.pages.studio.agents.form.testModel.success"),
  error: i18n.t("ai.pages.studio.agents.form.testModel.error"),
});

const onTestModel = async () => {
  if (!state.llmProviderId || !state.model) return;

  await test(
    $trpc.ai.agent.testModel.mutate({
      llmProviderId: state.llmProviderId,
      model: state.model,
      reasoningEffort: state.reasoningEffort,
      streaming: state.streaming,
      temperature: state.temperature,
      maxTokens: state.maxTokens,
      topP: state.topP,
      frequencyPenalty: state.frequencyPenalty,
      presencePenalty: state.presencePenalty,
    }),
  );
};
</script>

<template>
  <UModal
    :close="false"
    :dismissible="false"
    :title="$t(`ai.pages.studio.agents.${props.id ? 'edit' : 'create'}.title`)"
    :description="$t(`ai.pages.studio.agents.${props.id ? 'edit' : 'create'}.description`)"
  >
    <template #body>
      <UForm
        :state="state"
        :schema="schema"
        :validate-on="['change']"
        class="w-full max-w-150 space-y-4"
        @submit="onSubmit"
      >
        <UFormField required name="name" :label="$t('ai.pages.studio.agents.form.name.label')">
          <UInput
            v-model="state.name"
            type="text"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.agents.form.name.placeholder')"
          />
        </UFormField>
        <UFormField name="description" :label="$t('ai.pages.studio.agents.form.description.label')">
          <UTextarea
            v-model="state.description"
            autoresize
            :maxrows="3"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.agents.form.description.placeholder')"
          />
        </UFormField>
        <UFormField required name="instructions" :label="$t('ai.pages.studio.agents.form.instructions.label')">
          <UTextarea
            v-model="state.instructions"
            autoresize
            :maxrows="10"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.agents.form.instructions.placeholder')"
          />
        </UFormField>
        <UFormField name="greetingMessage" :label="$t('ai.pages.studio.agents.form.greetingMessage.label')">
          <UTextarea
            v-model="state.greetingMessage"
            autoresize
            :maxrows="5"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.agents.form.greetingMessage.placeholder')"
          />
        </UFormField>
        <UFormField name="editors" :label="$t('ai.pages.studio.agents.form.editors.label')">
          <SearchMenu
            v-model="state.editors"
            multiple
            class="w-full"
            :icon-fn="getIcon"
            :search-fn="search"
            :label-fn="getLabel"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.agents.form.editors.placeholder')"
          />
        </UFormField>
        <UFormField name="users" :label="$t('ai.pages.studio.agents.form.users.label')">
          <SearchMenu
            v-model="state.users"
            multiple
            class="w-full"
            :icon-fn="getIcon"
            :search-fn="search"
            :label-fn="getLabel"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.agents.form.users.placeholder')"
          />
        </UFormField>
        <UFormField v-if="!props.id" required name="type" :label="$t('ai.pages.studio.agents.form.type.label')">
          <URadioGroup
            v-model="state.type"
            size="sm"
            variant="table"
            :items="typeOptions"
            :disabled="!canModify"
            orientation="horizontal"
          />
        </UFormField>
        <UFormField
          v-if="state.type === 'triage'"
          name="specialists"
          :label="$t('ai.pages.studio.agents.form.specialists.label')"
        >
          <SearchMenu
            v-model="state.specialists"
            multiple
            class="w-full"
            :disabled="!canModify"
            :label-fn="getSpecialistLabel"
            :search-fn="searchSpecialists"
            :icon-fn="() => 'i-lucide-bot'"
            :placeholder="$t('ai.pages.studio.agents.form.specialists.placeholder')"
          />
        </UFormField>
        <UFormField name="llmProviderId" :label="$t('ai.pages.studio.agents.form.llmProvider.label')">
          <SearchMenu
            v-model="selectedLlmProviderId"
            class="w-full"
            :disabled="!canModify"
            :label-fn="getLlmProviderLabel"
            :search-fn="searchLlmProviders"
            :placeholder="$t('ai.pages.studio.agents.form.llmProvider.placeholder')"
          />
        </UFormField>
        <UFormField required name="model" :label="$t('ai.pages.studio.agents.form.model.label')">
          <UInput
            v-model="state.model"
            type="text"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.agents.form.model.placeholder')"
          />
        </UFormField>
        <UFormField name="summaryModel" :label="$t('ai.pages.studio.agents.form.summaryModel.label')">
          <UInput
            v-model="state.summaryModel"
            type="text"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('ai.pages.studio.agents.form.summaryModel.placeholder')"
          />
        </UFormField>
        <UFormField name="reasoningEffort" :label="$t('ai.pages.studio.agents.form.reasoningEffort.label')">
          <UInputMenu
            v-model="state.reasoningEffort"
            ignore-filter
            open-on-click
            class="w-full"
            mode="autocomplete"
            :disabled="!canModify"
            :items="reasoningEffortOptions"
            :placeholder="$t('ai.pages.studio.agents.form.reasoningEffort.placeholder')"
          />
        </UFormField>
        <UFormField
          v-if="state.type === 'specialist'"
          name="mcpServers"
          :label="$t('ai.pages.studio.agents.form.mcpServers.label')"
          :description="$t('ai.pages.studio.agents.form.mcpServers.hint')"
        >
          <SearchMenu
            v-model="state.mcpServers"
            multiple
            class="w-full"
            :disabled="!canModify"
            :label-fn="getMcpServerLabel"
            :search-fn="searchMcpServers"
            :placeholder="$t('ai.pages.studio.agents.form.mcpServers.placeholder')"
          />
        </UFormField>
        <UFormField
          v-if="state.type === 'specialist'"
          name="skills"
          :label="$t('ai.pages.studio.agents.form.skills.label')"
          :description="$t('ai.pages.studio.agents.form.skills.hint')"
        >
          <SearchMenu
            v-model="state.skills"
            multiple
            class="w-full"
            :disabled="!canModify"
            :label-fn="getSkillLabel"
            :search-fn="searchSkills"
            :placeholder="$t('ai.pages.studio.agents.form.skills.placeholder')"
          />
        </UFormField>
        <template v-if="state.type === 'specialist'">
          <UFormField
            v-for="provider in assignableToolProviders"
            :key="provider.name"
            :label="$t(provider.label)"
            :description="$t('ai.pages.studio.agents.form.toolResources.hint')"
          >
            <SearchMenu
              v-model="toolResources[provider.name]"
              multiple
              class="w-full"
              :disabled="!canModify"
              :label-fn="getToolResourceLabel"
              :placeholder="$t('ai.pages.studio.agents.form.toolResources.placeholder')"
              :search-fn="(query?: string) => searchToolResources(provider.name, query)"
            />
          </UFormField>
        </template>
        <UFormField
          v-if="state.type === 'specialist'"
          name="streaming"
          :label="$t('ai.pages.studio.agents.form.streaming.label')"
        >
          <USwitch
            v-model="state.streaming"
            :disabled="!canModify"
            :description="$t('ai.pages.studio.agents.form.streaming.description')"
          />
        </UFormField>
        <UFormField
          v-if="state.type === 'specialist'"
          name="codeInterpreter"
          :label="$t('ai.pages.studio.agents.form.codeInterpreter.label')"
        >
          <USwitch
            v-model="state.codeInterpreter"
            :disabled="!canModify"
            :description="$t('ai.pages.studio.agents.form.codeInterpreter.description')"
          />
        </UFormField>
        <template v-if="state.type === 'specialist'">
          <UFormField v-for="provider in switchableToolProviders" :key="provider.name" :label="$t(provider.label)">
            <USwitch
              v-model="enabledToolProviders[provider.name]"
              :disabled="!canModify"
              :description="$t('ai.pages.studio.agents.form.toolProviders.description')"
            />
          </UFormField>
        </template>
        <UAccordion :ui="{ trigger: 'pt-0' }" :items="advancedSettingsItems">
          <template #leading>
            <UIcon class="size-5" name="i-lucide-settings-2" />
          </template>
          <template #trailing="{ open }">
            <UBadge v-if="advancedSettingsCount > 0" size="sm" color="primary" variant="subtle">
              {{ $t("ai.pages.studio.agents.form.advancedSettings.customized", { count: advancedSettingsCount }) }}
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
                :label="$t(`ai.pages.studio.agents.form.${key}.label`)"
                :description="$t(`ai.pages.studio.agents.form.${key}.hint`)"
              >
                <NumberParameterField
                  :max="params.max"
                  :min="params.min"
                  :step="params.step"
                  :disabled="!canModify"
                  :default="params.default"
                  :model-value="state[key]"
                  :default-hint="$t('ai.pages.studio.agents.form.advancedSettings.default', { value: params.default })"
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
            icon="i-lucide-flask-conical"
            :disabled="!state.llmProviderId || !state.model"
            @click="onTestModel"
          >
            {{
              testing
                ? $t("ai.pages.studio.agents.form.testModel.testing")
                : $t("ai.pages.studio.agents.form.testModel.label")
            }}
          </UButton>
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("ai.pages.studio.agents.form.cancel") }}
          </UButton>
          <UButton type="submit" color="primary" variant="solid" icon="i-lucide-save" :disabled="!canModify">
            {{ $t(`ai.pages.studio.agents.form.${props.id ? "save" : "create"}`) }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
