import type { InjectionKey, Ref } from "vue";

export interface SidebarState {
  open: Readonly<Ref<boolean>>;
  toggle: () => void;
}

export const sidebarKey: InjectionKey<SidebarState> = Symbol("sidebar");
