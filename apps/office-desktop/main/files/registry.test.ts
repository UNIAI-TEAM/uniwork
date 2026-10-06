import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import type { FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import { FileHandleRegistry, LocalFileError, atomicReplace, type FileSystemPort } from "./registry";

const tempRoots: string[] = [];
async function tempRoot(): Promise<string> { const root = resolve("../../.uniwork-dev-run/files", `files-${Date.now()}-${Math.random().toString(16).slice(2)}`); await fs.mkdir(root, { recursive: true }); tempRoots.push(root); return root; }
afterEach(async () => { while (tempRoots.length) await fs.rm(tempRoots.pop()!, { recursive: true, force: true }); });

describe("desktop local file handles", () => {
  it("issues an opaque handle only from an OS-selected path and revokes it", async () => {
    const root = await tempRoot(); const path = join(root, "draft.txt"); await fs.writeFile(path, "old");
    const registry = new FileHandleRegistry({ sessionId: "s1", randomBytes: (size) => new Uint8Array(size).fill(3) });
    const metadata = await registry.openPath(path);
    expect(metadata.handle).toMatch(/^file_[A-Za-z0-9_-]{32,}$/);
    expect(JSON.stringify(metadata)).not.toContain(root);
    expect(await registry.read(metadata.handle)).toEqual(new TextEncoder().encode("old"));
    expect((await registry.openEvent(path)).name).toBe("draft.txt");
    await expect(registry.read("C:\\arbitrary\\file.txt")).rejects.toMatchObject({ code: "invalid_handle" });
    registry.revokeSession();
    await expect(registry.read(metadata.handle)).rejects.toMatchObject({ code: "session_revoked" });
  });

  it("refuses symlinks and external modifications", async () => {
    const root = await tempRoot(); const target = join(root, "target.txt"); const link = join(root, "link.txt"); await fs.writeFile(target, "old");
    const native = { lstat: (p: string) => fs.lstat(p), stat: (p: string) => fs.stat(p), realpath: (p: string) => fs.realpath(p), readFile: async (p: string) => new Uint8Array(await fs.readFile(p)), open: (p: string, f: string | number) => fs.open(p, f), rename: (from: string, to: string) => fs.rename(from, to), unlink: (p: string) => fs.unlink(p) } satisfies FileSystemPort;
    const symlinkFs = { ...native, lstat: async (p: string) => p === link ? ({ isSymbolicLink: () => true, isFile: () => false } as unknown as Stats) : native.lstat(p) } satisfies FileSystemPort;
    const registry = new FileHandleRegistry({ sessionId: "s", fs: symlinkFs });
    await expect(registry.openPath(link)).rejects.toMatchObject({ code: "symlink_refused" });
    const nativeRegistry = new FileHandleRegistry({ sessionId: "s", fs: native }); const metadata = await nativeRegistry.openPath(target); await fs.writeFile(target, "outside");
    await expect(nativeRegistry.save(metadata.handle, new TextEncoder().encode("new"))).rejects.toMatchObject({ code: "external_modification" });
    await expect(fs.readFile(target, "utf8")).resolves.toBe("outside");
  });

  it("refuses an ancestor symlink before opening the selected file", async () => {
    const root = await tempRoot(); const escaped = join(root, "escaped"); const target = join(escaped, "target.txt");
    await fs.mkdir(escaped, { recursive: true }); await fs.writeFile(target, "old");
    const native = { lstat: (p: string) => fs.lstat(p), stat: (p: string) => fs.stat(p), realpath: (p: string) => fs.realpath(p), readFile: async (p: string) => new Uint8Array(await fs.readFile(p)), open: (p: string, f: string | number) => fs.open(p, f), rename: (from: string, to: string) => fs.rename(from, to), unlink: (p: string) => fs.unlink(p) } satisfies FileSystemPort;
    const ancestorSymlinkFs = { ...native, lstat: async (p: string) => p === escaped ? ({ isSymbolicLink: () => true, isFile: () => false } as unknown as Stats) : native.lstat(p) } satisfies FileSystemPort;
    await expect(new FileHandleRegistry({ sessionId: "s", fs: ancestorSymlinkFs }).openPath(target)).rejects.toMatchObject({ code: "symlink_refused" });
  });

  it("refuses a locked target before atomic replacement", async () => {
    const root = await tempRoot(); const path = join(root, "locked.txt"); await fs.writeFile(path, "old");
    const native = { lstat: (p: string) => fs.lstat(p), stat: (p: string) => fs.stat(p), realpath: (p: string) => fs.realpath(p), readFile: async (p: string) => new Uint8Array(await fs.readFile(p)), open: (p: string, f: string | number) => fs.open(p, f), rename: (from: string, to: string) => fs.rename(from, to), unlink: (p: string) => fs.unlink(p) } satisfies FileSystemPort;
    const metadata = await new FileHandleRegistry({ sessionId: "s", fs: native }).openPath(path);
    const lockedFs = { ...native, open: async (p: string, f: string | number) => { if (p === path && f === "r+") throw new Error("sharing violation"); return native.open(p, f); } } satisfies FileSystemPort;
    const lockedRegistry = new FileHandleRegistry({ sessionId: "s", fs: lockedFs });
    const lockedMetadata = await lockedRegistry.openPath(path);
    await expect(lockedRegistry.save(lockedMetadata.handle, new TextEncoder().encode("new"))).rejects.toMatchObject({ code: "locked" });
    expect(metadata.byteLength).toBe(3); expect(await fs.readFile(path, "utf8")).toBe("old");
  });

  it("keeps target bytes when temp write, fsync, or replace fails", async () => {
    const root = await tempRoot(); const path = join(root, "target.txt"); await fs.writeFile(path, "old");
    const native = {
      lstat: (p: string) => fs.lstat(p), stat: (p: string) => fs.stat(p), realpath: (p: string) => fs.realpath(p), readFile: async (p: string) => new Uint8Array(await fs.readFile(p)), open: (p: string, f: string | number) => fs.open(p, f), rename: (from: string, to: string) => fs.rename(from, to), unlink: (p: string) => fs.unlink(p),
    } satisfies FileSystemPort;
    const metadata = await new FileHandleRegistry({ sessionId: "s", fs: native }).openPath(path);
    const failing = { ...native, rename: async () => { throw new Error("replace failed"); } } satisfies FileSystemPort;
    await expect(atomicReplace(path, new TextEncoder().encode("new"), failing)).rejects.toMatchObject({ code: "replace_failed" });
    await expect(fs.readFile(path, "utf8")).resolves.toBe("old");
    expect(metadata.byteLength).toBe(3);
    const fakeHandle = (fault: "write" | "sync") => ({ writeFile: vi.fn(async () => { if (fault === "write") throw new Error("write failed"); }), sync: vi.fn(async () => { if (fault === "sync") throw new Error("fsync failed"); }), close: vi.fn(async () => undefined) }) as unknown as FileHandle;
    const faultFs = (fault: "write" | "sync") => ({ ...native, open: async (p: string, f: string | number) => p.includes(".uniwork-") ? fakeHandle(fault) : native.open(p, f) }) satisfies FileSystemPort;
    await expect(atomicReplace(path, new TextEncoder().encode("new"), faultFs("write"))).rejects.toMatchObject({ code: "write_failed" });
    await expect(atomicReplace(path, new TextEncoder().encode("new"), faultFs("sync"))).rejects.toMatchObject({ code: "write_failed" });
    expect(await fs.readFile(path, "utf8")).toBe("old");
  });

  it("Save As uses the main picker and never accepts a renderer path", async () => {
    const root = await tempRoot(); const source = join(root, "source.txt"); const destination = join(root, "new.txt"); await fs.writeFile(source, "old");
    const registry = new FileHandleRegistry({ sessionId: "s" }); const metadata = await registry.openPath(source);
    const result = await registry.saveAs(metadata.handle, new TextEncoder().encode("new"), { pick: async () => destination });
    expect(result?.name).toBe("new.txt"); expect(await fs.readFile(destination, "utf8")).toBe("new");
  });
});

// A local working file is never size-capped: the desktop host must open, save
// and atomically replace a file above the old 128 MiB ceiling. The fixture is
// generated here (sparse where the filesystem allows) and removed afterEach.
describe("desktop local files are not size-capped", () => {
  const ABOVE_OLD_CAP = 130 * 1024 * 1024;
  async function sparse(path: string, size: number): Promise<void> {
    const handle = await fs.open(path, "w");
    try { await handle.truncate(size); } finally { await handle.close(); }
  }

  it("opens, saves and atomically replaces a file above 128 MiB", async () => {
    const root = await tempRoot(); const path = join(root, "big.docx"); await sparse(path, ABOVE_OLD_CAP);
    const registry = new FileHandleRegistry({ sessionId: "s" });
    const metadata = await registry.openPath(path);
    expect(metadata.byteLength).toBe(ABOVE_OLD_CAP);
    expect((await registry.read(metadata.handle)).byteLength).toBe(ABOVE_OLD_CAP);
    const replacement = new Uint8Array(ABOVE_OLD_CAP + 1); replacement[ABOVE_OLD_CAP] = 7;
    const saved = await registry.save(metadata.handle, replacement);
    expect(saved.byteLength).toBe(ABOVE_OLD_CAP + 1);
    await atomicReplace(path, new Uint8Array(ABOVE_OLD_CAP + 2));
    expect((await fs.stat(path)).size).toBe(ABOVE_OLD_CAP + 2);
    await sparse(join(root, "second.docx"), 1);
    const second = await registry.openPath(join(root, "second.docx"));
    expect((await registry.saveAs(second.handle, new Uint8Array(ABOVE_OLD_CAP + 3), { pick: async () => join(root, "copy.docx") }))?.byteLength).toBe(ABOVE_OLD_CAP + 3);
  }, 60_000);

  it.each([
    ["a RangeError from an allocation", Object.assign(new RangeError("Array buffer allocation failed"), {})],
    ["an invalid typed array length", new RangeError("Invalid typed array length: 4294967297")],
    ["Node's 2 GiB readFile refusal", Object.assign(new RangeError("File size is greater than 2 GiB"), { code: "ERR_FS_FILE_TOO_LARGE" })],
    ["a string that is too long", Object.assign(new Error("Cannot create a string longer than 0x1fffffe8 characters"), { code: "ERR_STRING_TOO_LONG" })],
  ])("answers %s while reading as insufficient_memory, not not_found", async (_label, failure) => {
    const root = await tempRoot(); const path = join(root, "huge.pptx"); await fs.writeFile(path, "x");
    const native = { lstat: (p: string) => fs.lstat(p), stat: (p: string) => fs.stat(p), realpath: (p: string) => fs.realpath(p), open: (p: string, f: string | number) => fs.open(p, f), rename: (a: string, b: string) => fs.rename(a, b), unlink: (p: string) => fs.unlink(p) };
    const failing = { ...native, readFile: async () => { throw failure; } } satisfies FileSystemPort;
    await expect(new FileHandleRegistry({ sessionId: "s", fs: failing }).openPath(path)).rejects.toMatchObject({ code: "insufficient_memory" });
    const missing = { ...native, readFile: async () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); } } satisfies FileSystemPort;
    await expect(new FileHandleRegistry({ sessionId: "s", fs: missing }).openPath(path)).rejects.toMatchObject({ code: "not_found" });
  });

  it("answers an allocation failure while writing as insufficient_memory", async () => {
    const root = await tempRoot(); const path = join(root, "out.docx");
    const failing = { lstat: (p: string) => fs.lstat(p), stat: (p: string) => fs.stat(p), realpath: (p: string) => fs.realpath(p), readFile: async (p: string) => new Uint8Array(await fs.readFile(p)), rename: (a: string, b: string) => fs.rename(a, b), unlink: (p: string) => fs.unlink(p), open: async () => { throw new RangeError("Array buffer allocation failed"); } } satisfies FileSystemPort;
    await expect(atomicReplace(path, new Uint8Array(1), failing)).rejects.toMatchObject({ code: "insufficient_memory" });
  });
});
