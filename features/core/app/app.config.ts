import type { AppConfigInput } from "nuxt/schema";

export default {
  ui: {
    colors: {
      primary: "sky",
      neutral: "zinc",
    },
    modal: {
      slots: { header: "shrink-0", footer: "shrink-0" },
    },
  },
} satisfies AppConfigInput;
