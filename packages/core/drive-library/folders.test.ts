import { describe, expect, it } from "vitest";
import { driveFoldersFromGroups, shortDriveFolderId } from "./folders";

describe("driveFoldersFromGroups", () => {
  it("drops the no-parent group, trims blank names to unnamed and keeps the server counts", () => {
    const folders = driveFoldersFromGroups(
      [
        { id: null, name: null, file_count: 9 },
        { id: "zzz999aaa", name: "  ", file_count: 1 },
        { id: "fld-b", name: "Báo cáo", file_count: 4 },
        { id: "fld-a", name: "Dự án 2", file_count: 2 },
      ],
      "vi",
    );
    expect(folders.map((x) => [x.id, x.name, x.shortId, x.fileCount])).toEqual([
      ["fld-b", "Báo cáo", "fld-b", 4],
      ["fld-a", "Dự án 2", "fld-a", 2],
      ["zzz999aaa", null, "zzz999", 1],
    ]);
  });

  it("orders named A-Z with the numeric collator, then unnamed by id, and merges a repeated id", () => {
    const folders = driveFoldersFromGroups(
      [
        { id: "f10", name: "Phòng 10", file_count: 1 },
        { id: "f2", name: "Phòng 2", file_count: 1 },
        { id: "f2", name: null, file_count: 2 },
      ],
      "vi",
    );
    expect(folders.map((x) => [x.name, x.fileCount])).toEqual([
      ["Phòng 2", 3],
      ["Phòng 10", 1],
    ]);
  });

  it("orders named folders A-Z with diacritics and numbers, then unnamed ones by id", () => {
    const folders = driveFoldersFromGroups(
      [
        { id: "zzz999aaa", name: null, file_count: 1 },
        { id: "fld-b", name: "Báo cáo", file_count: 1 },
        { id: "aaa111bbb", name: null, file_count: 1 },
        { id: "fld-a", name: "Alpha", file_count: 1 },
        { id: "fld-e", name: "Đề án", file_count: 1 },
        { id: "fld-10", name: "Quý 10", file_count: 1 },
        { id: "fld-2", name: "Quý 2", file_count: 1 },
      ],
      "vi",
    );
    expect(folders.map((x) => x.id)).toEqual(["fld-a", "fld-b", "fld-e", "fld-2", "fld-10", "aaa111bbb", "zzz999aaa"]);
    expect(shortDriveFolderId("abc")).toBe("abc");
  });
});
