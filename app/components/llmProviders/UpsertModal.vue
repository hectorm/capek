<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";
import { computed, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { z } from "zod/v4";

import { useToast } from "#imports";

import type { FormSubmitEvent } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UFieldGroup from "@nuxt/ui/components/FieldGroup.vue";
import UForm from "@nuxt/ui/components/Form.vue";
import UFormField from "@nuxt/ui/components/FormField.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UModal from "@nuxt/ui/components/Modal.vue";
import UTextarea from "@nuxt/ui/components/Textarea.vue";

import type { RouterInputs, RouterOutputs } from "~/types/trpc";
import type { HttpHeader } from "~~/shared/http";
import { usePermissions } from "~/composables/permissions";
import { usePrincipalSearch } from "~/composables/principal-search";
import { useUserStore } from "~/stores/user";
import { HttpHeadersSchema, HttpRedactedValue } from "~~/shared/http";
import { Permissions } from "~~/shared/rbac";

import SearchMenu from "~/components/ui/SearchMenu.vue";

type LlmProviderGetOutput = RouterOutputs["llmProvider"]["read"];
type LlmProviderCreateInput = RouterInputs["llmProvider"]["create"];
type LlmProviderUpdateInput = RouterInputs["llmProvider"]["update"];
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
  props.id ? $trpc.llmProvider.read.query({ id: props.id }) : Promise.resolve(null),
  props.id ? $trpc.llmProvider.listAccess.query({ llmProviderId: props.id }) : Promise.resolve([]),
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
    return can(Permissions.LlmProviderCreate);
  }
  const principalIds = currentAccess.filter((a) => a.role === "editor").map((a) => a.id);
  return canAny([Permissions.LlmProviderUpdateAll, Permissions.LlmProviderUpdateOwn], principalIds);
});

const schema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(1000).trim().default(""),
  apiUrl: z.url(),
  apiKey: z.string().max(1000).trim().default(""),
  headers: HttpHeadersSchema.default([]),
  editors: z.array(z.string()).default([]),
  users: z.array(z.string()).default([]),
});

type Schema = z.infer<typeof schema>;

const editors = currentAccess.filter((a) => a.role === "editor");
const editorIds = editors.map((a) => `${a.type}:${a.id}`);

const users = currentAccess.filter((a) => a.role === "user");
const userIds = users.map((a) => `${a.type}:${a.id}`);

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
  apiKey: llmProvider?.apiKey,
  headers: llmProvider?.headers ?? [],
  editors: editorIds,
  users: userIds,
});

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
      const result = await $trpc.llmProvider.update.mutate({
        id: event.data.id,
        name: event.data.name,
        description: event.data.description,
        apiUrl: event.data.apiUrl,
        apiKey: event.data.apiKey,
        headers: event.data.headers,
      });
      llmProvider = result;
      llmProviderId = result.id;
    } else {
      const result = await $trpc.llmProvider.create.mutate({
        name: event.data.name,
        description: event.data.description,
        apiUrl: event.data.apiUrl,
        apiKey: event.data.apiKey,
        headers: event.data.headers,
      });
      llmProvider = result;
      llmProviderId = result.id;
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
    await $trpc.llmProvider.syncAccess.mutate({ llmProviderId, access });

    emit("close", { llmProvider, error: null });
  } catch {
    const action = props.id ? "update" : "create";
    toast.add({
      color: "error",
      title: i18n.t(`pages.studio.llmProviders.table.actions.${action}.error.title`),
      description: i18n.t(`pages.studio.llmProviders.table.actions.${action}.error.description`),
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
    :title="$t(`pages.studio.llmProviders.${props.id ? 'edit' : 'create'}.title`)"
    :description="$t(`pages.studio.llmProviders.${props.id ? 'edit' : 'create'}.description`)"
  >
    <template #body>
      <UForm
        :state="state"
        :schema="schema"
        :validate-on="['change']"
        class="w-full max-w-150 space-y-4"
        @submit="onSubmit"
      >
        <UFormField required name="name" :label="$t('pages.studio.llmProviders.form.name.label')">
          <UInput
            v-model="state.name"
            type="text"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('pages.studio.llmProviders.form.name.placeholder')"
          />
        </UFormField>
        <UFormField name="description" :label="$t('pages.studio.llmProviders.form.description.label')">
          <UTextarea
            v-model="state.description"
            autoresize
            :maxrows="3"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('pages.studio.llmProviders.form.description.placeholder')"
          />
        </UFormField>
        <UFormField required name="apiUrl" :label="$t('pages.studio.llmProviders.form.apiUrl.label')">
          <UInput
            v-model="state.apiUrl"
            type="url"
            class="w-full"
            :disabled="!canModify"
            :placeholder="$t('pages.studio.llmProviders.form.apiUrl.placeholder')"
          />
        </UFormField>
        <UFormField name="apiKey" :label="$t('pages.studio.llmProviders.form.apiKey.label')">
          <UInput
            v-model="state.apiKey"
            class="w-full"
            type="password"
            :disabled="!canModify"
            :placeholder="$t(`pages.studio.llmProviders.form.apiKey.placeholder`)"
            @input="state.apiKey === HttpRedactedValue && (state.apiKey = '')"
          />
        </UFormField>
        <UFormField name="headers" :label="$t('pages.studio.llmProviders.form.headers.label')">
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
                :placeholder="$t('pages.studio.llmProviders.form.headers.namePlaceholder')"
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
                :placeholder="$t('pages.studio.llmProviders.form.headers.valuePlaceholder')"
                @input="header.value === HttpRedactedValue && (header.value = '')"
              />
              <UButton
                v-if="canModify"
                color="neutral"
                variant="outline"
                icon="i-lucide-trash-2"
                :aria-label="$t('pages.studio.llmProviders.form.headers.remove')"
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
                :label="$t('pages.studio.llmProviders.form.headers.add')"
                @click="addHeader"
              />
            </UFieldGroup>
          </div>
        </UFormField>
        <UFormField name="editors" :label="$t('pages.studio.llmProviders.form.editors.label')">
          <SearchMenu
            v-model="state.editors"
            multiple
            class="w-full"
            :icon-fn="getIcon"
            :search-fn="search"
            :label-fn="getLabel"
            :disabled="!canModify"
            :placeholder="$t('pages.studio.llmProviders.form.editors.placeholder')"
          />
        </UFormField>
        <UFormField name="users" :label="$t('pages.studio.llmProviders.form.users.label')">
          <SearchMenu
            v-model="state.users"
            multiple
            class="w-full"
            :icon-fn="getIcon"
            :search-fn="search"
            :label-fn="getLabel"
            :disabled="!canModify"
            :placeholder="$t('pages.studio.llmProviders.form.users.placeholder')"
          />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="subtle" icon="i-lucide-ban" @click="onCancel">
            {{ $t("pages.studio.llmProviders.form.cancel") }}
          </UButton>
          <UButton type="submit" color="primary" variant="solid" icon="i-lucide-save" :disabled="!canModify">
            {{ $t(`pages.studio.llmProviders.form.${props.id ? "save" : "create"}`) }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
