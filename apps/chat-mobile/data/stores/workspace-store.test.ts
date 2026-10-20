import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => void store.set(key, value)),
  deleteItemAsync: vi.fn(async (key: string) => void store.delete(key)),
}));

import { getCurrentWorkspace, useWorkspaceStore } from "./workspace-store";

const acme = { orgSlug: "acme", wsSlug: "hq", wsId: "ws1" };

beforeEach(() => {
  store.clear();
  useWorkspaceStore.setState({ current: null, isRestored: false });
});

describe("workspace store", () => {
  it("sets, exposes synchronously and persists the current workspace", async () => {
    await useWorkspaceStore.getState().setCurrent(acme);
    expect(getCurrentWorkspace()).toEqual(acme);
    expect(JSON.parse(store.get("uniwork_chat_workspace") ?? "null")).toEqual(acme);
  });

  it("restores a persisted workspace and ignores garbage", async () => {
    store.set("uniwork_chat_workspace", JSON.stringify(acme));
    await useWorkspaceStore.getState().restore();
    expect(useWorkspaceStore.getState()).toMatchObject({ current: acme, isRestored: true });

    for (const raw of ["not json", JSON.stringify({ orgSlug: "a" }), JSON.stringify(null)]) {
      useWorkspaceStore.setState({ current: null, isRestored: false });
      store.set("uniwork_chat_workspace", raw);
      await useWorkspaceStore.getState().restore();
      expect(useWorkspaceStore.getState()).toMatchObject({ current: null, isRestored: true });
    }
  });

  it("marks restored with nothing stored", async () => {
    await useWorkspaceStore.getState().restore();
    expect(useWorkspaceStore.getState()).toMatchObject({ current: null, isRestored: true });
  });

  it("clears memory and storage", async () => {
    await useWorkspaceStore.getState().setCurrent(acme);
    await useWorkspaceStore.getState().clear();
    expect(getCurrentWorkspace()).toBeNull();
    expect(store.has("uniwork_chat_workspace")).toBe(false);
  });
});
