import { onBeforeUnmount, ref } from "vue";

import { useToast } from "@nuxt/ui/composables/useToast";

import type { TestResult } from "#layers/core/shared/types";

export const useFormTest = (titles: { success: string; error: string }) => {
  const toast = useToast();

  const testing = ref(false);
  let toastId: string | number | undefined;

  const removeToast = () => {
    if (toastId !== undefined) {
      toast.remove(toastId);
    }
  };

  const test = async (run: Promise<TestResult>): Promise<void> => {
    testing.value = true;
    removeToast();

    let result: TestResult;
    try {
      result = await run;
    } catch (error) {
      result = { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      testing.value = false;
    }

    toastId = result.success
      ? toast.add({ color: "success", title: titles.success }).id
      : toast.add({ color: "error", title: titles.error, description: result.error, duration: 15000 }).id;
  };

  onBeforeUnmount(removeToast);

  return { testing, test };
};
