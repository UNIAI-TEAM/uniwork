// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setCurrentWorkspace } from "../../platform/workspace-storage";
import {
  PROJECT_DEFAULT_HIDDEN_COLUMNS,
  resetProjectViewStoreForTests,
  useProjectViewStore,
} from "./view-store";

const flush = () => new Promise((resolve) => queueMicrotask(() => resolve(null)));

beforeAll(() => {
  if (typeof globalThis.localStorage?.clear !== "function") {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (k) => values.get(k) ?? null,
      key: (i) => Array.from(values.keys())[i] ?? null,
      removeItem: (k) => {
        values.delete(k);
      },
      setItem: (k, v) => {
        values.set(k, v);
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
  }
});

beforeEach(() => {
  localStorage.clear();
  resetProjectViewStoreForTests();
  setCurrentWorkspace(null, null);
});

afterEach(() => {
  setCurrentWorkspace(null, null);
});

describe("project view store", () => {
  it("hides tasks column by default", () => {
    expect(PROJECT_DEFAULT_HIDDEN_COLUMNS).toContain("tasks");
    expect(PROJECT_DEFAULT_HIDDEN_COLUMNS).not.toContain("issues");
  });

  it("toggles view mode", () => {
    useProjectViewStore.getState().setViewMode("comfortable");
    expect(useProjectViewStore.getState().viewMode).toBe("comfortable");
  });

  it("defaults to compact with created desc sort", () => {
    const state = useProjectViewStore.getState();
    expect(state.viewMode).toBe("compact");
    expect(state.sortField).toBe("created");
    expect(state.sortDirection).toBe("desc");
    expect(state.hiddenColumns).toEqual(["tasks"]);
  });

  it("partialize persists view prefs under the workspace-namespaced key", async () => {
    setCurrentWorkspace("acme", "ws_a");
    await flush();
    useProjectViewStore.getState().setViewMode("comfortable");

    const raw = localStorage.getItem("uniwork_projects_view:acme");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as {
      state: Record<string, unknown>;
    };
    expect(Object.keys(parsed.state).sort()).toEqual([
      "filters",
      "hiddenColumns",
      "sortDirection",
      "sortField",
      "viewMode",
    ]);
    expect(parsed.state.viewMode).toBe("comfortable");
  });

  it("rehydrates a different saved viewMode on workspace switch", async () => {
    localStorage.setItem(
      "uniwork_projects_view:acme",
      JSON.stringify({ state: { viewMode: "comfortable" }, version: 0 }),
    );
    localStorage.setItem(
      "uniwork_projects_view:beta",
      JSON.stringify({ state: { viewMode: "compact" }, version: 0 }),
    );

    setCurrentWorkspace("acme", "ws_a");
    await flush();
    await flush();
    expect(useProjectViewStore.getState().viewMode).toBe("comfortable");

    setCurrentWorkspace("beta", "ws_b");
    await flush();
    await flush();
    expect(useProjectViewStore.getState().viewMode).toBe("compact");
  });
});
