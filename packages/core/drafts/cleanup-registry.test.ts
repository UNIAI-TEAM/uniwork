import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearDraftCleanupRegistryForTest,
  registerOfficeDraftMemoryCleanup,
  clearRegisteredGlobalDrafts,
  registerDraftCleanup,
} from "./cleanup-registry";
import { resetAuthStoreForTests, useAuthStore } from "../auth/store";

beforeEach(() => {
  __clearDraftCleanupRegistryForTest();
  resetAuthStoreForTests();
});

afterEach(() => vi.unstubAllGlobals());

describe("clearRegisteredGlobalDrafts", () => {
  it("removes every registered global key and leaves workspace-scoped keys alone", () => {
    const adapter = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const owned = { resetInMemory: vi.fn(), isOwnedBy: () => true };
    registerDraftCleanup({ storageKey: "uniwork_global_a", workspaceScoped: false, ...owned });
    registerDraftCleanup({ storageKey: "uniwork_global_b", workspaceScoped: false, ...owned });
    registerDraftCleanup({ storageKey: "uniwork_scoped", workspaceScoped: true, ...owned });

    clearRegisteredGlobalDrafts(adapter);

    expect(adapter.removeItem).toHaveBeenCalledWith("uniwork_global_a");
    expect(adapter.removeItem).toHaveBeenCalledWith("uniwork_global_b");
    // A scoped key is `${storageKey}:${slug}`; without a slug there is nothing
    // real to remove, and removing the bare base key would be a no-op lie.
    expect(adapter.removeItem).toHaveBeenCalledTimes(2);
  });
});

describe("Office memory cleanup", () => {
  it("runs on account switch without deleting durable draft ciphertext", () => {
    const clearMemory = vi.fn();
    registerOfficeDraftMemoryCleanup(clearMemory);
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
    const user = (id: string) => ({ id, email: `${id}@example.test`, display_name: id });
    useAuthStore.setState({ status: "authed", user: user("account-a") });
    useAuthStore.setState({ status: "authed", user: user("account-b") });
    expect(clearMemory).toHaveBeenCalledTimes(1);
  });
});
