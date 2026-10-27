import { describe, expect, it } from "vitest";
import { deriveDriveFolders, driveFilesInFolder, shortDriveFolderId } from "./folders";

type F = { id: string; drive_folder?: { id: string; name: string | null } | null };
const f = (id: string, folder?: F["drive_folder"]): F => ({ id, drive_folder: folder });

describe("deriveDriveFolders", () => {
  it("yields no folders and every file unfiled for an old server or an empty list", () => {
    expect(deriveDriveFolders<F>([])).toEqual({ folders: [], unfiled: [] });
    const files = [f("a", null), f("b"), {} as F];
    const derived = deriveDriveFolders(files);
    expect(derived.folders).toEqual([]);
    expect(derived.unfiled).toEqual(files);
  });

  it("orders named A-Z with the numeric collator, then unnamed by id", () => {
    const { folders } = deriveDriveFolders(
      [
        f("1", { id: "zzz999aaa", name: null }),
        f("2", { id: "fld-b", name: "Báo cáo" }),
        f("3", { id: "aaa111bbb", name: null }),
        f("4", { id: "fld-a", name: "Alpha" }),
        f("5", { id: "fld-e", name: "Đề án" }),
        f("6", { id: "fld-10", name: "Quý 10" }),
        f("7", { id: "fld-2", name: "Quý 2" }),
      ],
      "vi",
    );
    expect(folders.map((x) => x.id)).toEqual(["fld-a", "fld-b", "fld-e", "fld-2", "fld-10", "aaa111bbb", "zzz999aaa"]);
  });

  it("counts files per folder and keeps unfiled in incoming order", () => {
    const { folders, unfiled } = deriveDriveFolders([
      f("1", { id: "x", name: "X" }),
      f("2", null),
      f("3", { id: "x", name: "X" }),
      f("4", { id: "y", name: null }),
      f("5"),
    ]);
    expect(folders.map((x) => [x.id, x.fileCount])).toEqual([["x", 2], ["y", 1]]);
    expect(unfiled.map((x) => x.id)).toEqual(["2", "5"]);
  });

  it("lets a name win when the same folder arrives named and unnamed, and trims it", () => {
    const { folders } = deriveDriveFolders([
      f("1", { id: "x", name: null }),
      f("2", { id: "x", name: "  Dự án Beta " }),
    ]);
    expect(folders).toEqual([{ id: "x", name: "Dự án Beta", shortId: "x", fileCount: 2 }]);
  });

  it("treats a blank name as unnamed and shortens ids to 6 characters", () => {
    const { folders } = deriveDriveFolders([f("1", { id: "1xYz9QabcDEF", name: "   " })]);
    expect(folders[0]).toMatchObject({ name: null, shortId: "1xYz9Q" });
    expect(shortDriveFolderId("abc")).toBe("abc");
  });
});

describe("driveFilesInFolder", () => {
  it("returns only the files of that folder, in order", () => {
    const files = [f("1", { id: "x", name: "X" }), f("2", { id: "y", name: "Y" }), f("3", { id: "x", name: "X" }), f("4")];
    expect(driveFilesInFolder(files, "x").map((x) => x.id)).toEqual(["1", "3"]);
    expect(driveFilesInFolder(files, "missing")).toEqual([]);
  });
});
