import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearWorkspaceStorage } from "./storage-cleanup";
import {
  registerDraftCleanup,
  __clearDraftCleanupRegistryForTest,
} from "../drafts/cleanup-registry";

beforeEach(() => {
  __clearDraftCleanupRegistryForTest();
});

describe("clearWorkspaceStorage", () => {
  it("removes all non-draft workspace-scoped keys for the given slug", () => {
    const adapter = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    clearWorkspaceStorage(adapter, "ws_123");

    // The list is deliberately short: usf's entries were its own stores'
    // persist keys. UniWork's non-draft workspace-scoped state is navigation
    // only; draft stores register themselves rather than being listed here.
    expect(adapter.removeItem).toHaveBeenCalledWith("uniwork_navigation:ws_123");
    expect(adapter.removeItem).toHaveBeenCalledTimes(1);
  });

  it("also clears registered draft keys via the registry", () => {
    const adapter = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    registerDraftCleanup({
      storageKey: "uniwork_test_draft",
      workspaceScoped: true,
      resetInMemory: vi.fn(),
    });
    registerDraftCleanup({
      storageKey: "uniwork_test_global_draft",
      workspaceScoped: false,
      resetInMemory: vi.fn(),
    });

    clearWorkspaceStorage(adapter, "ws_123");

    expect(adapter.removeItem).toHaveBeenCalledWith("uniwork_test_draft:ws_123");
    // Globally-namespaced draft keys are removed without the slug suffix.
    expect(adapter.removeItem).toHaveBeenCalledWith("uniwork_test_global_draft");
    // 1 non-draft key + 2 registered draft keys.
    expect(adapter.removeItem).toHaveBeenCalledTimes(3);
  });
});
