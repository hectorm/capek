import type { Ref } from "vue";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import type { ChatSession } from "~~/shared/schema";

export interface ChatGroup {
  id: string;
  label: string;
  items: ChatItem[];
}

export interface ChatItem {
  id: string;
  label: string;
  to: string;
  createdAt: Date;
}

export const useChatUI = (sessions: Ref<ChatSession[]>) => {
  const i18n = useI18n();
  const searchQuery = ref<string>("");

  const formattedSessions = computed(() =>
    sessions.value.map((s: ChatSession) => ({
      id: s.id,
      label: s.title || i18n.t("pages.chat.untitled"),
      to: `/chat/${s.id}`,
      createdAt: s.createdAt,
    })),
  );

  const filteredSessions = computed(() => {
    if (!searchQuery.value) return formattedSessions.value;

    const query = searchQuery.value.toLowerCase();
    return formattedSessions.value.filter((s: ChatItem) => s.label.toLowerCase().includes(query));
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

    filteredSessions.value.forEach((s: ChatItem) => {
      const sessionDate = new Date(s.createdAt);

      if (sessionDate >= todayStart) {
        today.push(s);
      } else if (sessionDate >= yesterdayStart) {
        yesterday.push(s);
      } else if (sessionDate >= oneWeekAgo) {
        lastWeek.push(s);
      } else if (sessionDate >= oneMonthAgo) {
        lastMonth.push(s);
      } else {
        const monthYear = sessionDate.toLocaleDateString(i18n.locale.value, { month: "long", year: "numeric" });
        older[monthYear] ??= [];
        older[monthYear].push(s);
      }
    });

    if (today.length) {
      groups.push({ id: "today", label: i18n.t("pages.chat.dateGroups.today"), items: today });
    }
    if (yesterday.length) {
      groups.push({ id: "yesterday", label: i18n.t("pages.chat.dateGroups.yesterday"), items: yesterday });
    }
    if (lastWeek.length) {
      groups.push({ id: "last-week", label: i18n.t("pages.chat.dateGroups.lastWeek"), items: lastWeek });
    }
    if (lastMonth.length) {
      groups.push({ id: "last-month", label: i18n.t("pages.chat.dateGroups.lastMonth"), items: lastMonth });
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
    searchQuery,
    formattedSessions,
    filteredSessions,
    groupedSessions,
  };
};
