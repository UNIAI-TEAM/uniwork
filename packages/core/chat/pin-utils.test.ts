import { describe, expect, it } from "vitest";
import { comparePinnedMessages } from "./pin-utils";

describe("comparePinnedMessages", () => {
  it("orders by pinned_at when both pins have it", () => {
    expect(
      comparePinnedMessages(
        { pinned_at: "2026-03-26T09:00:00Z", created_at: "2026-03-26T08:00:00Z" },
        { pinned_at: "2026-03-26T10:00:00Z", created_at: "2026-03-26T11:00:00Z" },
      ),
    ).toBeGreaterThan(0);
  });
});
