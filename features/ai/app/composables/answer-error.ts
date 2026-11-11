import { useI18n } from "vue-i18n";

import { ChatAnswerError } from "#layers/ai/app/stores/chat";
import { ChatStreamErrors } from "#layers/ai/shared/chat";

export const useAnswerError = () => {
  const i18n = useI18n();

  const describeAnswerError = (error: unknown, fallback: string): string => {
    for (let cause = error; cause instanceof Error; cause = cause.cause) {
      if (cause instanceof ChatAnswerError && cause.reason !== ChatStreamErrors.Failed) {
        return i18n.t(`ai.pages.chat.errors.${cause.reason}`);
      }
    }
    return fallback;
  };

  return { describeAnswerError };
};
