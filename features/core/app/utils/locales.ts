import type { Locale } from "vue-i18n";
import { en as zodEn, es as zodEs } from "zod/v4/locales";

import { en, es } from "@nuxt/ui/locale";

export const locales = {
  en: { ui: en, zod: zodEn },
  es: { ui: es, zod: zodEs },
} satisfies Record<Locale, { ui: typeof en; zod: typeof zodEn }>;
