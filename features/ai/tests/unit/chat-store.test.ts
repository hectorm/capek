import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe("chat history", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps older messages loaded during a resend when the answer and refresh fail", async () => {
    const store = useChatStore(createPinia());
    const post = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", () => post.promise);
    listMessages
      .mockResolvedValueOnce({
        messages: [{ id: "target", role: "user", content: "original" }],
        nextCursor: ["old", "cursor"],
      })
      .mockResolvedValueOnce({ messages: [{ id: "older", role: "user", content: "older" }] })
      .mockRejectedValueOnce(new Error("Offline"));

    await store.fetchMessages("chat");
    const send = store.sendMessage("chat", "revised", "target");
    await store.loadOlderMessages("chat");
    post.resolve(
      new Response('event: error\ndata: "failed"\n\n', { headers: { "Content-Type": "text/event-stream" } }),
    );

    await expect(send).rejects.toThrow("Failed to send message");
    expect(store.messages.get("chat")?.map((m) => m.content)).toEqual(["older", "revised"]);
    expect(store.hasOlderMessages("chat")).toBe(false);
  });

  it("keeps the new turn when an aborted send finishes during the next one", async () => {
    const store = useChatStore(createPinia());
    const earlier = Promise.withResolvers<Response>();
    const current = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(earlier.promise).mockReturnValueOnce(current.promise));

    const first = store.sendMessage("chat", "first");
    store.abortStream("chat");
    const second = store.sendMessage("chat", "second");

    earlier.reject(new DOMException("Aborted", "AbortError"));
    await first;
    expect(store.messages.get("chat")?.map((m) => m.content)).toEqual(["second", ""]);
    current.resolve(Response.json({}));
    await second;
  });

  it("keeps the latest messages and cursor when an earlier refresh finishes last", async () => {
    const store = useChatStore(createPinia());
    const earlier = Promise.withResolvers<{ messages: { id: string }[]; nextCursor: string[] }>();
    listMessages
      .mockReturnValueOnce(earlier.promise)
      .mockResolvedValueOnce({ messages: [{ id: "original" }, { id: "reply" }] });

    const first = store.fetchMessages("chat");
    await store.fetchMessages("chat");
    expect(store.isLoadingMessages).toBe(false);
    earlier.resolve({ messages: [{ id: "original" }], nextCursor: ["old", "cursor"] });
    await first;

    expect(store.messages.get("chat")?.map((m) => m.id)).toEqual(["original", "reply"]);
    expect(store.hasOlderMessages("chat")).toBe(false);
  });
});
