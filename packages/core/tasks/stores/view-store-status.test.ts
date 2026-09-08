// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import { viewStoreSlice, type TaskViewState } from "./view-store";

/**
 * Column visibility and the status filter used to be the same field. That was
 * only ever correct while a category held exactly one status; a category can
 * hold several, and the two questions have different answers.
 */
describe("column visibility vs status filter", () => {
  let store: StoreApi<TaskViewState>;
  beforeEach(() => {
    store = createStore<TaskViewState>()((set) => viewStoreSlice(set));
  });

  it("hiding a column does not touch the status filter", () => {
    store.getState().hideStatus("backlog");

    expect(store.getState().hiddenStatusCategories).toEqual(["backlog"]);
    expect(store.getState().statusFilters).toEqual([]);
  });

  it("showing a column restores it without inventing a filter", () => {
    store.getState().hideStatus("backlog");
    store.getState().hideStatus("done");
    store.getState().showStatus("backlog");

    expect(store.getState().hiddenStatusCategories).toEqual(["done"]);
    expect(store.getState().statusFilters).toEqual([]);
  });

  it("hiding the same column twice is idempotent", () => {
    store.getState().hideStatus("backlog");
    store.getState().hideStatus("backlog");

    expect(store.getState().hiddenStatusCategories).toEqual(["backlog"]);
  });

  it("a custom status filter survives hiding and showing a column", () => {
    store.getState().toggleStatusFilter("qa");
    store.getState().hideStatus("backlog");
    store.getState().showStatus("backlog");

    expect(store.getState().statusFilters).toEqual(["qa"]);
  });

  it("reset restores every column", () => {
    store.getState().hideStatus("backlog");
    store.getState().clearFilters();

    expect(store.getState().hiddenStatusCategories).toEqual([]);
  });
});
