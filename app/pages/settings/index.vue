<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { definePageMeta, useToast } from "#imports";

import UButton from "@nuxt/ui/components/Button.vue";
import UFieldGroup from "@nuxt/ui/components/FieldGroup.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UInputNumber from "@nuxt/ui/components/InputNumber.vue";
import USelect from "@nuxt/ui/components/Select.vue";
import USwitch from "@nuxt/ui/components/Switch.vue";
import UTextarea from "@nuxt/ui/components/Textarea.vue";

import type { RouterOutputs } from "~/types/trpc";
import { usePermissions } from "~/composables/permissions";
import { useSettingsStore } from "~/stores/settings";
import { Permissions } from "~~/shared/rbac";
import { SettingType } from "~~/shared/settings";

type SettingsListOutput = RouterOutputs["settings"]["list"];
type SettingDefinition = SettingsListOutput[keyof SettingsListOutput] & { key: string };
type SettingValue = string | string[] | number | boolean | null;

const i18n = useI18n();
const toast = useToast();
const settingsStore = useSettingsStore();

const { can } = usePermissions();

const saving = ref<boolean>(false);
const changedKeys = ref<Set<string>>(new Set());
const formValues = ref<Record<string, SettingValue>>({});
const formRef = ref<HTMLFormElement | null>(null);

const settingList = computed<SettingDefinition[]>(() => {
  if (!settingsStore.settings) return [];
  return Object.entries(settingsStore.settings).map(([key, setting]) => ({ ...setting, key }));
});

const categoryList = computed(() => {
  const categoryMap = new Map<string, SettingDefinition[]>();
  for (const setting of settingList.value) {
    if (!categoryMap.has(setting.category)) {
      categoryMap.set(setting.category, []);
    }
    const categorySettings = categoryMap.get(setting.category);
    if (categorySettings) {
      categorySettings.push(setting);
    }
  }
  return Array.from(categoryMap.entries()).map(([category, categorySettings]) => ({
    category,
    settings: categorySettings,
  }));
});

const updateSettingValue = (setting: SettingDefinition, value: SettingValue): void => {
  formValues.value[setting.key] = value;
  markSettingAsChanged(setting);
};

const addSettingListItem = (setting: SettingDefinition): void => {
  const current = formValues.value[setting.key] as string[];
  formValues.value[setting.key] = [...current, ""];
  markSettingAsChanged(setting);
};

const removeSettingListItem = (setting: SettingDefinition, index: number): void => {
  const current = formValues.value[setting.key] as string[];
  formValues.value[setting.key] = current.filter((_, i) => i !== index);
  markSettingAsChanged(setting);
};

const updateSettingListItem = (setting: SettingDefinition, index: number, value: string): void => {
  const current = formValues.value[setting.key] as string[];
  const updated = [...current];
  updated[index] = value;
  formValues.value[setting.key] = updated;
  markSettingAsChanged(setting);
};

const handleFileUpload = (setting: SettingDefinition, event: Event): void => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  if (setting.type === SettingType.File && file.size > setting.config.maxSize) {
    toast.add({
      color: "error",
      title: i18n.t("pages.settings.general.messages.fileTooLarge.title"),
      description: i18n.t("pages.settings.general.messages.fileTooLarge.description", {
        maxSize: Math.round(setting.config.maxSize / 1024),
      }),
    });
    input.value = "";
    return;
  }

  if (setting.type === SettingType.File && !setting.config.accept.includes(file.type)) {
    toast.add({
      color: "error",
      title: i18n.t("pages.settings.general.messages.invalidFileType.title"),
      description: i18n.t("pages.settings.general.messages.invalidFileType.description", {
        accept: setting.config.accept.join(", "),
      }),
    });
    input.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = (): void => {
    const base64String = reader.result as string;
    updateSettingValue(setting, base64String);
  };
  reader.onerror = (): void => {
    console.error("Failed to read file", reader.error);
    toast.add({
      color: "error",
      title: i18n.t("pages.settings.general.messages.fileReadError.title"),
      description: i18n.t("pages.settings.general.messages.fileReadError.description"),
    });
    input.value = "";
  };
  reader.readAsDataURL(file);
};

const markSettingAsChanged = (setting: SettingDefinition): void => {
  const currentValue = formValues.value[setting.key];
  const originalValue = setting.value;
  if (areSettingValuesEqual(currentValue, originalValue)) {
    changedKeys.value.delete(setting.key);
  } else {
    changedKeys.value.add(setting.key);
  }
};

const areSettingValuesEqual = (a?: SettingValue, b?: SettingValue): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((val, idx) => val === b[idx]);
  }
  return a === b;
};

const handleSaveAllSettings = async (): Promise<void> => {
  if (formRef.value && !formRef.value.checkValidity()) {
    formRef.value.reportValidity();
    return;
  }

  try {
    saving.value = true;

    const settingsToUpdate: { key: string; value: SettingValue }[] = [];

    for (const key of changedKeys.value) {
      const value = formValues.value[key];
      if (value === undefined) continue;
      settingsToUpdate.push({ key, value });
    }

    if (settingsToUpdate.length > 0) {
      await settingsStore.set(settingsToUpdate);
      updateFormValues();
    }

    toast.add({
      color: "success",
      title: i18n.t("pages.settings.general.messages.saveSuccess.title"),
      description: i18n.t("pages.settings.general.messages.saveSuccess.description"),
    });
  } catch (error) {
    console.error("Failed to save settings", error);
    toast.add({
      color: "error",
      title: i18n.t("pages.settings.general.messages.saveError.title"),
      description: i18n.t("pages.settings.general.messages.saveError.description"),
    });
  } finally {
    saving.value = false;
  }
};

const handleResetSetting = async (setting: SettingDefinition): Promise<void> => {
  try {
    saving.value = true;

    await settingsStore.set([{ key: setting.key, value: null }]);
    updateFormValues();

    toast.add({
      color: "success",
      title: i18n.t("pages.settings.general.messages.resetSuccess.title"),
      description: i18n.t("pages.settings.general.messages.resetSuccess.description"),
    });
  } catch (error) {
    console.error("Failed to reset setting", error);
    toast.add({
      color: "error",
      title: i18n.t("pages.settings.general.messages.resetError.title"),
      description: i18n.t("pages.settings.general.messages.resetError.description"),
    });
  } finally {
    saving.value = false;
  }
};

const updateFormValues = (): void => {
  const values: Record<string, SettingValue> = {};
  for (const setting of settingList.value) {
    values[setting.key] = setting.value;
  }
  formValues.value = values;
  changedKeys.value.clear();
};

onMounted(async () => {
  try {
    await settingsStore.fetch();
  } catch (error) {
    console.error(error);
    toast.add({
      color: "error",
      title: i18n.t("pages.settings.general.messages.fetchError.title"),
      description: i18n.t("pages.settings.general.messages.fetchError.description"),
    });
  }
  updateFormValues();
});

definePageMeta({
  title: "pages.settings.general.title",
  description: "pages.settings.general.description",
  permissions: [Permissions.SettingsReadAll],
});
</script>

<template>
  <form ref="formRef" class="flex flex-col gap-6 overflow-auto p-6" @submit.prevent="handleSaveAllSettings">
    <div v-if="settingsStore.loading" class="text-center text-muted">
      {{ $t("pages.settings.general.messages.loading") }}
    </div>
    <template v-else-if="settingsStore.settings">
      <div v-for="{ category, settings: categorySettings } in categoryList" :key="category" class="flex flex-col gap-4">
        <h2 class="text-lg font-semibold">
          {{ $t(`pages.settings.general.categories.${category}`) }}
        </h2>
        <div v-for="settingItem in categorySettings" :key="settingItem.key" class="flex flex-col gap-2">
          <div class="flex flex-col gap-2 rounded-lg border border-default p-4">
            <div class="flex items-center justify-between">
              <label class="font-medium" :for="settingItem.key">
                {{ $t(`pages.settings.general.fields['${settingItem.key}'].label`) }}
              </label>
              <div class="flex items-center gap-2">
                <span v-if="settingItem.isOverridden" class="text-xs text-primary">
                  {{ $t("pages.settings.general.actions.overridden") }}
                </span>
                <span v-else class="text-xs text-muted">
                  {{ $t("pages.settings.general.actions.usingDefault") }}
                </span>
              </div>
            </div>
            <p class="text-sm text-muted">
              {{ $t(`pages.settings.general.fields['${settingItem.key}'].description`) }}
            </p>
            <!-- STRING -->
            <UFieldGroup
              v-if="settingItem.type === SettingType.String || settingItem.type === SettingType.StringSecret"
            >
              <UInput
                :id="settingItem.key"
                class="flex-1"
                color="neutral"
                variant="outline"
                autocomplete="off"
                :type="settingItem.config.inputType"
                :pattern="settingItem.config.pattern"
                :maxlength="settingItem.config.maxLength"
                :minlength="settingItem.config.minLength"
                :required="settingItem.config.minLength > 0"
                :disabled="!can(Permissions.SettingsUpdateAll)"
                :model-value="formValues[settingItem.key] as string"
                :placeholder="$t(`pages.settings.general.fields['${settingItem.key}'].placeholder`)"
                @update:model-value="updateSettingValue(settingItem, $event)"
              />
              <UButton
                v-if="settingItem.isOverridden && can(Permissions.SettingsUpdateAll)"
                square
                color="neutral"
                :loading="saving"
                variant="outline"
                icon="i-lucide-rotate-ccw"
                :aria-label="$t('pages.settings.general.actions.reset')"
                @click="handleResetSetting(settingItem)"
              />
            </UFieldGroup>
            <!-- STRING LARGE -->
            <div v-else-if="settingItem.type === SettingType.StringLarge" class="flex flex-row gap-2">
              <UTextarea
                :id="settingItem.key"
                :rows="10"
                color="neutral"
                variant="outline"
                autocomplete="off"
                class="flex-1 font-mono"
                :maxlength="settingItem.config.maxLength"
                :minlength="settingItem.config.minLength"
                :required="settingItem.config.minLength > 0"
                :disabled="!can(Permissions.SettingsUpdateAll)"
                :model-value="formValues[settingItem.key] as string"
                :placeholder="$t(`pages.settings.general.fields['${settingItem.key}'].placeholder`)"
                @update:model-value="updateSettingValue(settingItem, $event)"
              />
              <UButton
                v-if="settingItem.isOverridden && can(Permissions.SettingsUpdateAll)"
                square
                color="neutral"
                :loading="saving"
                variant="outline"
                class="self-start"
                icon="i-lucide-rotate-ccw"
                :aria-label="$t('pages.settings.general.actions.reset')"
                @click="handleResetSetting(settingItem)"
              />
            </div>
            <!-- STRING LIST -->
            <div v-else-if="settingItem.type === SettingType.StringList" class="flex flex-col gap-2">
              <UFieldGroup v-for="(item, index) in formValues[settingItem.key] as string[]" :key="index">
                <UInput
                  class="flex-1"
                  color="neutral"
                  variant="outline"
                  autocomplete="off"
                  :model-value="item"
                  :pattern="settingItem.config.itemPattern"
                  :maxlength="settingItem.config.itemMaxLength"
                  :minlength="settingItem.config.itemMinLength"
                  :disabled="!can(Permissions.SettingsUpdateAll)"
                  :required="settingItem.config.itemMinLength > 0"
                  :placeholder="$t(`pages.settings.general.fields['${settingItem.key}'].placeholder`)"
                  @update:model-value="updateSettingListItem(settingItem, index, $event)"
                />
                <UButton
                  v-if="can(Permissions.SettingsUpdateAll)"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-trash-2"
                  :aria-label="$t(`pages.settings.general.fields['${settingItem.key}'].remove`)"
                  :disabled="
                    !can(Permissions.SettingsUpdateAll) ||
                    (formValues[settingItem.key] as string[])?.length <= settingItem.config.minItems
                  "
                  @click="removeSettingListItem(settingItem, index)"
                />
              </UFieldGroup>
              <UFieldGroup>
                <UButton
                  class="flex-1"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-plus"
                  :label="$t(`pages.settings.general.fields['${settingItem.key}'].add`)"
                  :disabled="
                    !can(Permissions.SettingsUpdateAll) ||
                    (formValues[settingItem.key] as string[])?.length >= settingItem.config.maxItems
                  "
                  @click="addSettingListItem(settingItem)"
                />
                <UButton
                  v-if="settingItem.isOverridden && can(Permissions.SettingsUpdateAll)"
                  square
                  color="neutral"
                  :loading="saving"
                  variant="outline"
                  icon="i-lucide-rotate-ccw"
                  :aria-label="$t('pages.settings.general.actions.reset')"
                  @click="handleResetSetting(settingItem)"
                />
              </UFieldGroup>
            </div>
            <!-- STRING CHOICE -->
            <UFieldGroup v-else-if="settingItem.type === SettingType.StringChoice">
              <USelect
                :id="settingItem.key"
                class="flex-1"
                color="neutral"
                variant="outline"
                :items="settingItem.config.options"
                :disabled="!can(Permissions.SettingsUpdateAll)"
                :model-value="formValues[settingItem.key] as string"
                :placeholder="$t(`pages.settings.general.fields['${settingItem.key}'].placeholder`)"
                @update:model-value="(value) => updateSettingValue(settingItem, String(value ?? ''))"
              />
              <UButton
                v-if="settingItem.isOverridden && can(Permissions.SettingsUpdateAll)"
                square
                color="neutral"
                :loading="saving"
                variant="outline"
                icon="i-lucide-rotate-ccw"
                :aria-label="$t('pages.settings.general.actions.reset')"
                @click="handleResetSetting(settingItem)"
              />
            </UFieldGroup>
            <!-- NUMBER -->
            <UFieldGroup v-else-if="settingItem.type === SettingType.Number">
              <UInputNumber
                color="neutral"
                variant="outline"
                :max="settingItem.config.max"
                :min="settingItem.config.min"
                :step="settingItem.config.step"
                :disabled="!can(Permissions.SettingsUpdateAll)"
                :model-value="(formValues[settingItem.key] as number) ?? 0"
                @update:model-value="updateSettingValue(settingItem, $event)"
              />
              <UButton
                v-if="settingItem.isOverridden && can(Permissions.SettingsUpdateAll)"
                square
                color="neutral"
                :loading="saving"
                variant="outline"
                icon="i-lucide-rotate-ccw"
                :aria-label="$t('pages.settings.general.actions.reset')"
                @click="handleResetSetting(settingItem)"
              />
            </UFieldGroup>
            <!-- BOOLEAN -->
            <div v-else-if="settingItem.type === SettingType.Boolean" class="flex flex-row items-center gap-2">
              <USwitch
                :id="settingItem.key"
                color="primary"
                :disabled="!can(Permissions.SettingsUpdateAll)"
                :model-value="(formValues[settingItem.key] as boolean) ?? false"
                @update:model-value="updateSettingValue(settingItem, $event)"
              />
              <UButton
                v-if="settingItem.isOverridden && can(Permissions.SettingsUpdateAll)"
                square
                color="neutral"
                :loading="saving"
                variant="outline"
                icon="i-lucide-rotate-ccw"
                :aria-label="$t('pages.settings.general.actions.reset')"
                @click="handleResetSetting(settingItem)"
              />
            </div>
            <!-- FILE -->
            <UFieldGroup v-else-if="settingItem.type === SettingType.File">
              <UInput
                :id="settingItem.key"
                type="file"
                class="flex-1"
                color="neutral"
                variant="outline"
                :model-value="undefined"
                :accept="settingItem.config.accept.join(',')"
                :disabled="!can(Permissions.SettingsUpdateAll)"
                :placeholder="
                  $t(`pages.settings.general.fields['${settingItem.key}'].placeholder`, {
                    maxSize: Math.round(settingItem.config.maxSize / 1024),
                  })
                "
                @change="handleFileUpload(settingItem, $event)"
              />
              <UButton
                v-if="settingItem.isOverridden && can(Permissions.SettingsUpdateAll)"
                square
                color="neutral"
                :loading="saving"
                variant="outline"
                icon="i-lucide-rotate-ccw"
                :aria-label="$t('pages.settings.general.actions.reset')"
                @click="handleResetSetting(settingItem)"
              />
            </UFieldGroup>
          </div>
        </div>
      </div>
      <div v-if="can(Permissions.SettingsUpdateAll)" class="flex justify-end border-t border-default pt-4">
        <UButton
          type="submit"
          color="primary"
          :loading="saving"
          icon="i-lucide-save"
          :disabled="changedKeys.size === 0"
          :label="$t('pages.settings.general.actions.save')"
        />
      </div>
    </template>
  </form>
</template>
