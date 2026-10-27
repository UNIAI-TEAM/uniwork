import { describe, expect, it, vi } from "vitest";
import {
  readCollapsedFolderGroups,
  readGroupByFolder,
  writeCollapsedFolderGroups,
  writeGroupByFolder,
} from "./folder-group-prefs";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe("group by folder preference", () => {
  it("defaults to on and round-trips per viewer", () => {
    const s = memory();
    expect(readGroupByFolder("u1", s)).toBe(true);
    writeGroupByFolder("u1", false, s);
    expect(readGroupByFolder("u1", s)).toBe(false);
    expect(readGroupByFolder("u2", s)).toBe(true);
    writeGroupByFolder("u1", true, s);
    expect(readGroupByFolder("u1", s)).toBe(true);
  });

  it("reads on without a viewer or storage, and survives a throwing store", () => {
    expect(readGroupByFolder(null, memory())).toBe(true);
    expect(readGroupByFolder("u1", null)).toBe(true);
    const broken = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };
    expect(readGroupByFolder("u1", broken)).toBe(true);
    expect(() => writeGroupByFolder("u1", false, broken)).not.toThrow();
  });
});

describe("collapsed folder groups", () => {
  it("round-trips and drops non-string entries", () => {
    const s = memory();
    writeCollapsedFolderGroups("u1", ["a", "b"], s);
    expect(readCollapsedFolderGroups("u1", s)).toEqual(["a", "b"]);
    s.data.set("uniwork_drive_collapsed_folders:u1", JSON.stringify(["a", 3, null]));
    expect(readCollapsedFolderGroups("u1", s)).toEqual(["a"]);
  });

  it("reads a malformed value as every group open", () => {
    const s = memory({ "uniwork_drive_collapsed_folders:u1": "{nope" });
    expect(readCollapsedFolderGroups("u1", s)).toEqual([]);
    s.data.set("uniwork_drive_collapsed_folders:u1", JSON.stringify({ a: 1 }));
    expect(readCollapsedFolderGroups("u1", s)).toEqual([]);
    expect(readCollapsedFolderGroups(null, s)).toEqual([]);
  });
});
