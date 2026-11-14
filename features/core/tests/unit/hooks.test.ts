import { describe, expect, it, vi } from "vitest";

import type { User } from "#layers/core/shared/schema";
import { runUserSyncHooks } from "#layers/core/server/lib/authn/hooks";

vi.mock("#layers/core/server/lib/features", () => ({
  getServerFeatures: () => [
    { name: "first", onUserSync: failing },
    { name: "second" },
    { name: "third", onUserSync: recording },
  ],
}));

const failing = vi.fn(() => Promise.reject(new Error("Unavailable")));
const recording = vi.fn(() => Promise.resolve());

describe("user sync hooks", () => {
  it("run in each feature that has one, even after another one fails", async () => {
    const user = { id: crypto.randomUUID(), email: "alice@example.com" } as User;
    const claims = { department: "Sales" };

    await expect(runUserSyncHooks(user, claims)).resolves.toBeUndefined();

    expect(failing).toHaveBeenCalledWith({ user, claims });
    expect(recording).toHaveBeenCalledWith({ user, claims });
  });
});
