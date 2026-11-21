import type { ComputedRef, Ref } from "vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import type { ChatSession } from "#layers/ai/shared/schema";

export interface ChatGroup {
  id: string;
  label: string;
  items: ChatItem[];
}

export interface ChatItem {
  id: string;
  label: string;
  to: string;
  updatedAt: Date;
}

export interface ChatUI {
  groupedSessions: ComputedRef<ChatGroup[]>;
}

export const useChatUI = (sessions: Ref<ChatSession[]>): ChatUI => {
  const i18n = useI18n();

  const formattedSessions = computed(() => {
    return sessions.value.map((session) => ({
      id: session.id,
      label: session.title || i18n.t("ai.pages.chat.untitled"),
      to: `/ai/chat/${session.id}`,
      updatedAt: session.updatedAt,
    }));
  });

  const groupedSessions = computed(() => {
    const groups: ChatGroup[] = [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const oneWeekAgo = new Date(todayStart);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneMonthAgo = new Date(todayStart);
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const today: ChatItem[] = [];
    const yesterday: ChatItem[] = [];
    const lastWeek: ChatItem[] = [];
    const lastMonth: ChatItem[] = [];
    const older: Record<string, ChatItem[]> = {};

    formattedSessions.value.forEach((item) => {
      const sessionDate = new Date(item.updatedAt);

      if (sessionDate >= todayStart) {
        today.push(item);
      } else if (sessionDate >= yesterdayStart) {
        yesterday.push(item);
      } else if (sessionDate >= oneWeekAgo) {
        lastWeek.push(item);
      } else if (sessionDate >= oneMonthAgo) {
        lastMonth.push(item);
      } else {
        const monthYear = sessionDate.toLocaleDateString(i18n.locale.value, { month: "long", year: "numeric" });
        older[monthYear] ??= [];
        older[monthYear].push(item);
      }
    });

    if (today.length) {
      groups.push({ id: "today", label: i18n.t("ai.pages.chat.dateGroups.today"), items: today });
    }
    if (yesterday.length) {
      groups.push({ id: "yesterday", label: i18n.t("ai.pages.chat.dateGroups.yesterday"), items: yesterday });
    }
    if (lastWeek.length) {
      groups.push({ id: "last-week", label: i18n.t("ai.pages.chat.dateGroups.lastWeek"), items: lastWeek });
    }
    if (lastMonth.length) {
      groups.push({ id: "last-month", label: i18n.t("ai.pages.chat.dateGroups.lastMonth"), items: lastMonth });
    }

    const sortedMonthYears = Object.keys(older).sort((a, b) => {
      const dateA = new Date(a);
      const dateB = new Date(b);
      return dateB.getTime() - dateA.getTime();
    });

    sortedMonthYears.forEach((monthYear) => {
      groups.push({
        id: monthYear.toLowerCase().replace(/\s+/g, "-"),
        label: monthYear,
        items: older[monthYear] ?? [],
      });
    });

    return groups;
  });

  return {
    groupedSessions,
  };
};
