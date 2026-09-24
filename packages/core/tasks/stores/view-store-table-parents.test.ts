// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import {
  mergeViewStatePersisted,
  viewStorePersistOptions,
  viewStoreSlice,
  type TaskViewState,
} from "./view-store";

/**
 * Table parents used to be open unless listed; now they are closed unless
 * listed. A stored list of collapsed ids means the opposite of the new field,
 * so it is dropped rather than read as "expanded".
 */
describe("table expanded parents", () => {
  const defaults = () => createStore<TaskViewState>()((set) => viewStoreSlice(set)).getState();

  it("starts with every parent closed and toggles one open and closed", () => {
    const store = createStore<TaskViewState>()((set) => viewStoreSlice(set));
    expect(store.getState().tableExpandedParents).toEqual([]);

    store.getState().toggleTableParentExpanded("p1");
    expect(store.getState().tableExpandedParents).toEqual(["p1"]);
    store.getState().toggleTableParentExpanded("p1");
    expect(store.getState().tableExpandedParents).toEqual([]);
  });

  it("drops a persisted list of collapsed parents instead of opening them", () => {
    const merged = mergeViewStatePersisted({ tableCollapsedParents: ["p1", "p2"] }, defaults());

    expect(merged.tableExpandedParents).toEqual([]);
    expect(merged).not.toHaveProperty("tableCollapsedParents");
  });

  it("keeps a persisted list of expanded parents", () => {
    const merged = mergeViewStatePersisted({ tableExpandedParents: ["p3"] }, defaults());
    expect(merged.tableExpandedParents).toEqual(["p3"]);
  });

  it("persists the expanded list and not the old field", () => {
    const store = createStore<TaskViewState>()((set) => viewStoreSlice(set));
    store.getState().toggleTableParentExpanded("p1");
    const persisted = viewStorePersistOptions("k").partialize(store.getState());

    expect(persisted.tableExpandedParents).toEqual(["p1"]);
    expect(persisted).not.toHaveProperty("tableCollapsedParents");
  });
});
