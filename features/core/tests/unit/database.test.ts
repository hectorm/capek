import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it, vi } from "vitest";

import { useDb } from "#layers/core/server/lib/database";
import { closeDb } from "#layers/core/tests/unit/helpers/db";

vi.mock("@electric-sql/pglite", { spy: true });

afterAll(async () => {
  await closeDb();
});

describe("database", () => {
  it("is set up once for the calls that arrive at the same time", async () => {
    await Promise.all([useDb(), useDb()]);
    expect(PGlite).toHaveBeenCalledTimes(1);
  });
});
