import type { Locale } from "vue-i18n";
import * as zodLocales from "zod/v4/locales";

import { en, es } from "@nuxt/ui/locale";

export const locales = {
  en: { ui: en, zod: zodLocales.en },
  es: { ui: es, zod: zodLocales.es },
} satisfies Record<Locale, { ui: typeof en; zod: typeof zodLocales.en }>;
