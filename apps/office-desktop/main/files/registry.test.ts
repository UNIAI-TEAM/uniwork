import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import { FileHandleRegistry, LocalFileError, atomicReplace, type FileSystemPort } from "./registry";

const tempRoots: string[] = [];
async function tempRoot(): Promise<string> { const root = join("D:\\", "uniwork-office-tests", `files-${Date.now()}-${Math.random().toString(16).slice(2)}`); await fs.mkdir(root, { recursive: true }); tempRoots.push(root); return root; }
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
