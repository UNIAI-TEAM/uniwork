import { describe, expect, it } from "vitest";
import { groupsStorageKey, readCollapsedGroups, toggleCollapsedGroup, writeCollapsedGroups } from "./group-state";

// UNI-2045 W11: the collapsed date groups live under
// `uniwork_documents_groups:{userId}` as `{ "<screen>": ["<groupId>", ...] }`
// through the StorageAdapter; any storage failure renders every group open.

function memory(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe("group-state", () => {
  it("keys the state per user", () => {
    expect(groupsStorageKey("u1")).toBe("uniwork_documents_groups:u1");
  });

  it("writes and reads the collapsed groups per user and per screen", () => {
    const storage = memory();
    writeCollapsedGroups("u1", { recent: ["today"], trash: ["more_than_7_days"] }, storage);
    expect(JSON.parse(storage.map.get("uniwork_documents_groups:u1")!)).toEqual({ recent: ["today"], trash: ["more_than_7_days"] });
    expect(readCollapsedGroups("u1", storage)).toEqual({ recent: ["today"], trash: ["more_than_7_days"] });
    expect(readCollapsedGroups("u2", storage)).toEqual({});
  });

  it("toggles one group of one screen and leaves the other screens alone", () => {
    const start = { recent: ["today"], shared: ["earlier"] };
    expect(toggleCollapsedGroup(start, "recent", "earlier")).toEqual({ recent: ["today", "earlier"], shared: ["earlier"] });
    expect(toggleCollapsedGroup(start, "recent", "today")).toEqual({ recent: [], shared: ["earlier"] });
    expect(toggleCollapsedGroup({}, "trash", "deleting_soon")).toEqual({ trash: ["deleting_soon"] });
  });

  it("reads every group open from corrupt JSON, a wrong shape, unknown ids or a throwing storage", () => {
    const key = "uniwork_documents_groups:u1";
    expect(readCollapsedGroups("u1", memory({ [key]: "{not json" }))).toEqual({});
    expect(readCollapsedGroups("u1", memory({ [key]: "[1,2]" }))).toEqual({});
    expect(readCollapsedGroups("u1", memory({ [key]: JSON.stringify({ recent: "today", shared: [1, "earlier"], bogus: ["today"] }) }))).toEqual({
      shared: ["earlier"],
    });
    expect(readCollapsedGroups("u1", memory({ [key]: JSON.stringify({ trash: ["today", "deleting_soon"] }) }))).toEqual({ trash: ["deleting_soon"] });
    const throwing = {
      getItem: (): string | null => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readCollapsedGroups("u1", throwing)).toEqual({});
    expect(() => writeCollapsedGroups("u1", { recent: ["today"] }, throwing)).not.toThrow();
    expect(readCollapsedGroups(null, memory())).toEqual({});
  });
});
