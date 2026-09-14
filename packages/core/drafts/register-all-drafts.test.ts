import { describe, expect, it, vi } from "vitest";
import { clearRegisteredGlobalDrafts } from "./cleanup-registry";
// Deliberately the only store import: this proves the side-effect module is
// complete on its own, which is what logout relies on.
import "./register-all-drafts";

describe("register-all-drafts", () => {
  it("loads every store with a global persisted key, so logout cleanup reaches each one", () => {
    const adapter = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };

    clearRegisteredGlobalDrafts(adapter);

    expect(adapter.removeItem).toHaveBeenCalledWith("uniwork_task_comment_drafts");
    expect(adapter.removeItem).toHaveBeenCalledWith("uniwork_recent_tasks");
  });
});
