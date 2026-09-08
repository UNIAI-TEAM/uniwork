import { beforeEach, describe, expect, it } from "vitest";
import {
  PEOPLE_COLUMN_KEYS,
  resetPeopleViewStoreForTests,
  usePeopleViewStore,
} from "./view-store";

describe("usePeopleViewStore", () => {
  beforeEach(() => {
    localStorage.clear();
    resetPeopleViewStoreForTests();
  });

  it("opens on the card view", () => {
    expect(usePeopleViewStore.getState().viewMode).toBe("cards");
  });

  it("switches to the table and back", () => {
    usePeopleViewStore.getState().setViewMode("table");
    expect(usePeopleViewStore.getState().viewMode).toBe("table");
    usePeopleViewStore.getState().setViewMode("cards");
    expect(usePeopleViewStore.getState().viewMode).toBe("cards");
  });

  it("hides a column and shows it again", () => {
    usePeopleViewStore.getState().toggleColumn("email");
    expect(usePeopleViewStore.getState().hiddenColumns).toContain("email");
    usePeopleViewStore.getState().toggleColumn("email");
    expect(usePeopleViewStore.getState().hiddenColumns).not.toContain("email");
  });

  it("hides phone and status by default, so the table fits a laptop", () => {
    expect(usePeopleViewStore.getState().hiddenColumns).toEqual(["phone", "status"]);
  });

  it("writes the choice to storage so the next visit opens the same way", () => {
    usePeopleViewStore.getState().setViewMode("table");
    expect(localStorage.getItem("uniwork_people_view")).toContain("table");
  });

  it("gives a payload written before a key existed that key's default", () => {
    const merged = usePeopleViewStore.persist.getOptions().merge?.(
      { viewMode: "table" },
      usePeopleViewStore.getState(),
    ) as { viewMode: string; hiddenColumns: unknown };
    expect(merged.viewMode).toBe("table");
    expect(merged.hiddenColumns).toEqual(["phone", "status"]);
  });

  it("names every hideable column exactly once", () => {
    expect(new Set(PEOPLE_COLUMN_KEYS).size).toBe(PEOPLE_COLUMN_KEYS.length);
  });
});
