import { createPinia } from "pinia";
import { describe, expect, it, vi } from "vitest";

import { useChatStore } from "#layers/ai/app/stores/chat";

const { readSession, listMessages } = vi.hoisted(() => ({
  readSession: vi.fn(),
  listMessages: vi.fn().mockResolvedValue({ messages: [] }),
}));

vi.mock("nuxt/app", () => ({
  useNuxtApp: () => ({
    $trpc: { ai: { chatSession: { read: { query: readSession } }, chatMessage: { list: { query: listMessages } } } },
  }),
}));

describe("chat selection", () => {
  it("keeps the selected session when an earlier read finishes last", async () => {
    const store = useChatStore(createPinia());
    const earlier = Promise.withResolvers<{ id: string }>();
    readSession.mockReturnValueOnce(earlier.promise).mockResolvedValueOnce({ id: "second" });

    const firstSelection = store.selectSession("first");
    await store.selectSession("second");
    earlier.resolve({ id: "first" });
    await firstSelection;

    expect(store.currentSession?.id).toBe("second");
    expect(listMessages).toHaveBeenCalledTimes(1);
  });

  it("keeps loading the current messages when a cancelled read finishes", async () => {
    const store = useChatStore(createPinia());
    const earlier = Promise.withResolvers<{ messages: [] }>();
    const current = Promise.withResolvers<{ messages: [] }>();
    listMessages.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(current.promise);
    const controller = new AbortController();

    const firstLoad = store.fetchMessages("first", controller.signal);
    controller.abort();
    const secondLoad = store.fetchMessages("second");
    earlier.resolve({ messages: [] });
    await firstLoad;
    expect(store.messages.has("first")).toBe(false);
    expect(store.isLoadingMessages).toBe(true);

    current.resolve({ messages: [] });
    await secondLoad;
    expect(store.messages.has("second")).toBe(true);
    expect(store.isLoadingMessages).toBe(false);
  });
});
