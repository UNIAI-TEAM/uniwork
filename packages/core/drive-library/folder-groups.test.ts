import { describe, expect, it } from "vitest";
import { groupDriveFilesByFolder, shortDriveFolderId } from "./folder-groups";

type F = { id: string; drive_folder: { id: string; name: string | null } | null };
const f = (id: string, folder: F["drive_folder"]): F => ({ id, drive_folder: folder });

describe("groupDriveFilesByFolder", () => {
  it("returns null (flat list) for no files and when every parent is unknown", () => {
    expect(groupDriveFilesByFolder<F>([])).toBeNull();
    expect(groupDriveFilesByFolder([f("a", null), f("b", null)])).toBeNull();
    expect(groupDriveFilesByFolder([{} as F])).toBeNull();
  });

  it("orders named A-Z, then unnamed by short id, then unknown last", () => {
    const groups = groupDriveFilesByFolder(
      [
        f("1", null),
        f("2", { id: "zzz999aaa", name: null }),
        f("3", { id: "fld-b", name: "Báo cáo" }),
        f("4", { id: "aaa111bbb", name: null }),
        f("5", { id: "fld-a", name: "Alpha" }),
        f("6", { id: "fld-e", name: "Đề án" }),
      ],
      "vi",
    );
    expect(groups?.map((g) => [g.kind, g.key])).toEqual([
      ["named", "fld-a"],
      ["named", "fld-b"],
      ["named", "fld-e"],
      ["unnamed", "aaa111bbb"],
      ["unnamed", "zzz999aaa"],
      ["unknown", "unknown"],
    ]);
  });

  it("keeps incoming file order inside a group and counts only the files given (filtered set)", () => {
    const all = [
      f("1", { id: "x", name: "X" }),
      f("2", { id: "y", name: "Y" }),
      f("3", { id: "x", name: "X" }),
      f("4", null),
    ];
    const groups = groupDriveFilesByFolder(all);
    expect(groups?.find((g) => g.key === "x")?.files.map((x) => x.id)).toEqual(["1", "3"]);
    // A filter that matches only file 3 leaves one group; groups with no match do not exist.
    const filtered = groupDriveFilesByFolder(all.filter((x) => x.id === "3"));
    expect(filtered?.map((g) => [g.key, g.files.length])).toEqual([["x", 1]]);
  });

  it("makes one group per folder id even when two folders share a name, and tie-breaks by id", () => {
    const groups = groupDriveFilesByFolder([
      f("1", { id: "id-2", name: "Chung" }),
      f("2", { id: "id-1", name: "Chung" }),
    ]);
    expect(groups?.map((g) => g.key)).toEqual(["id-1", "id-2"]);
  });

  it("names a group once when the same folder arrives named on one file and unnamed on another", () => {
    const groups = groupDriveFilesByFolder([
      f("1", { id: "fld", name: null }),
      f("2", { id: "fld", name: "Hồ sơ" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups?.[0]).toMatchObject({ kind: "named", name: "Hồ sơ" });
  });

  it("treats a whitespace-only name as unnamed and exposes the 6-character short id", () => {
    const groups = groupDriveFilesByFolder([f("1", { id: "1AbCdEfGh", name: "  " })]);
    expect(groups?.[0]).toMatchObject({ kind: "unnamed", shortId: "1AbCdE" });
    expect(shortDriveFolderId("abc")).toBe("abc");
  });
});
