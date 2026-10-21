import { describe, expect, it } from "vitest";
import { entriesFromInputFiles, readDroppedFolders } from "./read-web";

type FakeNode = { name: string; isFile: boolean; isDirectory: boolean };

function fakeFile(name: string, size = 1): FakeNode & { file: (ok: (f: File) => void, fail: (e: Error) => void) => void } {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (ok) => ok(new File([new Uint8Array(size)], name)),
  };
}

/** A directory whose reader hands out `batchSize` children per `readEntries` call. */
function fakeDir(name: string, children: FakeNode[], batchSize = 100, readCalls: { n: number } = { n: 0 }) {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: (ok: (entries: FakeNode[]) => void) => {
          readCalls.n += 1;
          const batch = children.slice(offset, offset + batchSize);
          offset += batch.length;
          queueMicrotask(() => ok(batch));
        },
      };
    },
  };
}

function item(entry: FakeNode | null, file: File | null = null): DataTransferItem {
  return {
    kind: "file",
    webkitGetAsEntry: () => entry as unknown as FileSystemEntry | null,
    getAsFile: () => file,
  } as unknown as DataTransferItem;
}

describe("entriesFromInputFiles", () => {
  it("uses webkitRelativePath and falls back to the bare name", () => {
    const a = new File(["abc"], "a.docx");
    Object.defineProperty(a, "webkitRelativePath", { value: "Folder/sub/a.docx" });
    const b = new File(["z"], "b.pdf");
    expect(entriesFromInputFiles([a, b])).toEqual([
      { path: "Folder/sub/a.docx", size: 3, file: a },
      { path: "b.pdf", size: 1, file: b },
    ]);
  });
});

describe("readDroppedFolders", () => {
  it("reads a directory over several readEntries batches until an empty one", async () => {
    const calls = { n: 0 };
    const children = Array.from({ length: 250 }, (_, i) => fakeFile(`f${i}.pdf`));
    const dir = fakeDir("Big", children, 100, calls);
    const { folders } = await readDroppedFolders([item(dir)]);
    expect(folders).toHaveLength(1);
    expect(folders[0]).toHaveLength(250);
    expect(folders[0]?.[249]?.path).toBe("Big/f249.pdf");
    // 100 + 100 + 50, then the empty batch that ends the loop.
    expect(calls.n).toBe(4);
  });

  it("walks three levels and reports sizes", async () => {
    const deep = fakeDir("c", [fakeFile("x.docx", 7)]);
    const mid = fakeDir("b", [deep, fakeFile("y.pdf", 3)]);
    const top = fakeDir("a", [mid, fakeFile("z.txt", 2)]);
    const { folders } = await readDroppedFolders([item(top)]);
    const flat = folders[0]?.map((e) => [e.path, e.size]);
    expect(flat).toEqual([
      ["a/b/c/x.docx", 7],
      ["a/b/y.pdf", 3],
      ["a/z.txt", 2],
    ]);
    expect(folders[0]?.every((e) => e.file instanceof File)).toBe(true);
  });

  it("returns one list per dropped folder and the loose files beside them", async () => {
    const loose = new File(["q"], "loose.pdf");
    const { folders, looseFiles } = await readDroppedFolders([
      item(fakeDir("One", [fakeFile("1.pdf")])),
      item(fakeFile("loose.pdf"), loose),
      item(fakeDir("Two", [fakeFile("2.pdf")])),
    ]);
    expect(folders.map((f) => f.map((e) => e.path))).toEqual([["One/1.pdf"], ["Two/2.pdf"]]);
    expect(looseFiles).toEqual([loose]);
  });

  it("keeps an empty dropped folder as an empty list", async () => {
    const { folders } = await readDroppedFolders([item(fakeDir("Empty", []))]);
    expect(folders).toEqual([[]]);
  });

  it("takes a file with no entry support as a loose file", async () => {
    const f = new File(["q"], "plain.pdf");
    const { folders, looseFiles } = await readDroppedFolders([item(null, f)]);
    expect(folders).toEqual([]);
    expect(looseFiles).toEqual([f]);
  });

  it("captures every item before its first await", () => {
    let live = true;
    const dir = fakeDir("Gone", [fakeFile("a.pdf")]);
    const list = [
      {
        kind: "file",
        webkitGetAsEntry: () => (live ? (dir as unknown as FileSystemEntry) : null),
        getAsFile: () => null,
      } as unknown as DataTransferItem,
    ];
    const pending = readDroppedFolders(list);
    live = false; // the drop tick has ended
    return expect(pending).resolves.toMatchObject({ folders: [[{ path: "Gone/a.pdf" }]] });
  });

  it("rejects when a file cannot be read", async () => {
    const broken = { name: "bad.pdf", isFile: true, isDirectory: false, file: (_: unknown, fail: (e: Error) => void) => fail(new Error("denied")) };
    await expect(readDroppedFolders([item(fakeDir("R", [broken]))])).rejects.toThrow("denied");
  });

  it("ignores non-file items such as dragged text", async () => {
    const text = { kind: "string", webkitGetAsEntry: () => null, getAsFile: () => null } as unknown as DataTransferItem;
    expect(await readDroppedFolders([text])).toEqual({ folders: [], looseFiles: [], truncated: [] });
  });

  it("never opens a hidden directory, by the planner's hidden rule", async () => {
    const opened: string[] = [];
    const watched = (name: string, children: FakeNode[]) => {
      const dir = fakeDir(name, children);
      return { ...dir, createReader: () => (opened.push(name), dir.createReader()) };
    };
    const top = watched("R", [
      watched(".git", [fakeFile("HEAD")]),
      watched("__MACOSX", [fakeFile("._a.pdf")]),
      watched("sub", [fakeFile("b.pdf")]),
      fakeFile("a.pdf"),
    ]);
    const { folders, truncated } = await readDroppedFolders([item(top)]);
    expect(folders[0]?.map((e) => e.path)).toEqual(["R/sub/b.pdf", "R/a.pdf"]);
    expect(opened).toEqual(["R", "sub"]);
    expect(truncated).toEqual([false]);
  });

  it("stops reading a folder once it holds more than maxFiles x 4 files", async () => {
    let reads = 0;
    const counted = (name: string) => {
      const f = fakeFile(name);
      return { ...f, file: (ok: (file: File) => void, fail: (e: Error) => void) => ((reads += 1), f.file(ok, fail)) };
    };
    const big = fakeDir("Big", [
      fakeDir("a", Array.from({ length: 6 }, (_, i) => counted(`a${i}.pdf`))),
      fakeDir("b", Array.from({ length: 6 }, (_, i) => counted(`b${i}.pdf`))),
    ]);
    const small = fakeDir("Small", [fakeFile("s.pdf")]);
    const { folders, truncated } = await readDroppedFolders([item(big), item(small)], { maxFiles: 2 });
    // The bound is 8: the ninth file proves "over the limit" and the walk stops.
    expect(folders[0]).toHaveLength(9);
    expect(reads).toBe(9);
    expect(folders[1]).toHaveLength(1);
    expect(truncated).toEqual([true, false]);
  });
});
