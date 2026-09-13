import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearDraftCleanupRegistryForTest,
  clearRegisteredGlobalDrafts,
  registerDraftCleanup,
} from "./cleanup-registry";

beforeEach(() => {
  __clearDraftCleanupRegistryForTest();
});

describe("clearRegisteredGlobalDrafts", () => {
  it("removes every registered global key and leaves workspace-scoped keys alone", () => {
    const adapter = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    registerDraftCleanup({ storageKey: "uniwork_global_a", workspaceScoped: false, resetInMemory: vi.fn() });
    registerDraftCleanup({ storageKey: "uniwork_global_b", workspaceScoped: false, resetInMemory: vi.fn() });
    registerDraftCleanup({ storageKey: "uniwork_scoped", workspaceScoped: true, resetInMemory: vi.fn() });

    clearRegisteredGlobalDrafts(adapter);

    expect(adapter.removeItem).toHaveBeenCalledWith("uniwork_global_a");
    expect(adapter.removeItem).toHaveBeenCalledWith("uniwork_global_b");
    // A scoped key is `${storageKey}:${slug}`; without a slug there is nothing
    // real to remove, and removing the bare base key would be a no-op lie.
    expect(adapter.removeItem).toHaveBeenCalledTimes(2);
  });
});
