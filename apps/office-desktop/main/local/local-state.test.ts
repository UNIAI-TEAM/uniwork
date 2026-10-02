import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDeviceError, deviceScopeAccountId, loadOrCreateDeviceId } from "./device";
import { createLocalModeStore } from "./mode";
import { createRecentFilesStore, shortenDirectory } from "./recent-files";
import { createFakeDraftKeyStore } from "../drafts/test-fake";

const roots: string[] = [];
async function root(): Promise<string> { const path = resolve(".test-artifacts", `local-${Date.now()}-${Math.random().toString(16).slice(2)}`); await fs.mkdir(path, { recursive: true }); roots.push(path); return path; }
afterEach(async () => { while (roots.length) await fs.rm(roots.pop()!, { recursive: true, force: true }); });

describe("local device identity", () => {
  it("creates one durable device id and reads it back unchanged", async () => {
    const directory = await root();
    const first = await loadOrCreateDeviceId({ userDataDirectory: directory });
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(deviceScopeAccountId(first)).toBe(`local:${first}`);
    const second = await loadOrCreateDeviceId({ userDataDirectory: directory });
    expect(second).toBe(first);
    const record = JSON.parse(await fs.readFile(join(directory, "local", "device.json"), "utf8")) as { version: number; deviceId: string };
    expect(record).toEqual({ version: 1, deviceId: first });
  });

  it("fails closed on a corrupt device record instead of orphaning draft keys", async () => {
    const directory = await root();
    await fs.mkdir(join(directory, "local"), { recursive: true });
    await fs.writeFile(join(directory, "local", "device.json"), "not-json");
    await expect(loadOrCreateDeviceId({ userDataDirectory: directory })).rejects.toMatchObject({ code: "corrupt" });
    expect(LocalDeviceError).toBeDefined();
  });
});

describe("per-device local mode preference", () => {
  it("defaults to the sign-in card and persists the chosen mode", async () => {
    const directory = await root();
    const store = await createLocalModeStore({ userDataDirectory: directory });
    expect(store.get()).toBe(false);
    await store.set(true);
    expect(store.get()).toBe(true);
    const reopened = await createLocalModeStore({ userDataDirectory: directory });
    expect(reopened.get()).toBe(true);
    await reopened.set(false);
    expect((await createLocalModeStore({ userDataDirectory: directory })).get()).toBe(false);
  });

  it("treats a corrupt preference as the safe default", async () => {
    const directory = await root();
    await fs.mkdir(join(directory, "local"), { recursive: true });
    await fs.writeFile(join(directory, "local", "mode.json"), "{");
    expect((await createLocalModeStore({ userDataDirectory: directory })).get()).toBe(false);
  });
});

describe("encrypted recent files", () => {
  it("records, lists, reorders and removes device files without a path crossing the boundary", async () => {
    const directory = await root();
    let now = 1_000;
    const store = createRecentFilesStore({ userDataDirectory: directory, keyStore: createFakeDraftKeyStore(), deviceId: "a".repeat(32), now: () => now });
    const target = join(directory, "docs", "plan.docx");
    await fs.mkdir(join(directory, "docs"), { recursive: true });
    await fs.writeFile(target, "docx");
    await store.record({ path: target, name: "plan.docx", modifiedAtMs: 42 });
    now = 2_000;
    await store.record({ path: target, name: "plan.docx", modifiedAtMs: 42 });
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: "plan.docx", modifiedAtMs: 42, updatedAt: 2_000, missing: false });
    expect(JSON.stringify(listed)).not.toContain(directory);
    const id = listed[0]!.id;
    expect(id).toMatch(/^recent_[0-9a-f]{32}$/);
    expect((await store.resolve(id))?.path).toBe(resolve(target));
    await fs.rm(target);
    expect((await store.list())[0]?.missing).toBe(true);
    expect(await store.remove(id)).toBe(true);
    expect(await store.list()).toEqual([]);
  });

  it("stores the list encrypted: no path, name or JSON marker in the raw file", async () => {
    const directory = await root();
    const store = createRecentFilesStore({ userDataDirectory: directory, keyStore: createFakeDraftKeyStore(), deviceId: "b".repeat(32) });
    const target = join(directory, "secret-folder", "quarterly-plan.docx");
    await fs.mkdir(join(directory, "secret-folder"), { recursive: true });
    await fs.writeFile(target, "docx");
    await store.record({ path: target, name: "quarterly-plan.docx", modifiedAtMs: 7 });
    const raw = await fs.readFile(join(directory, "local", "recent-files.bin"), "utf8");
    expect(raw).not.toContain("quarterly-plan.docx");
    expect(raw).not.toContain(directory);
    expect(raw).not.toContain("entries");
    // The key store and the ciphertext are separate artifacts.
    const envelope = JSON.parse(raw) as { version: number; generation: number; ciphertext: string };
    expect(envelope.generation).toBe(1);
    expect(envelope.ciphertext.length).toBeGreaterThan(0);
  });

  it("fails closed when the key is gone instead of replacing the list", async () => {
    const directory = await root();
    const keys = createFakeDraftKeyStore();
    const store = createRecentFilesStore({ userDataDirectory: directory, keyStore: keys, deviceId: "c".repeat(32) });
    const target = join(directory, "plan.docx");
    await fs.writeFile(target, "docx");
    await store.record({ path: target, name: "plan.docx", modifiedAtMs: 1 });
    keys.clear();
    // A fresh process cannot decrypt and must not start a new list.
    const reopened = createRecentFilesStore({ userDataDirectory: directory, keyStore: keys, deviceId: "c".repeat(32) });
    await expect(reopened.list()).rejects.toMatchObject({ code: "locked" });
    const other = join(directory, "other.docx");
    await fs.writeFile(other, "docx");
    await expect(reopened.record({ path: other, name: "other.docx", modifiedAtMs: 2 })).rejects.toMatchObject({ code: "locked" });
    expect(await fs.readFile(target, "utf8")).toBe("docx");
  });

  it("keeps only the newest entries and shortens the displayed directory", async () => {
    const directory = await root();
    const store = createRecentFilesStore({ userDataDirectory: directory, keyStore: createFakeDraftKeyStore(), deviceId: "d".repeat(32), maxEntries: 3 });
    for (let index = 0; index < 5; index += 1) {
      const target = join(directory, "folder", `file-${index}.docx`);
      await fs.mkdir(join(directory, "folder"), { recursive: true });
      await fs.writeFile(target, "docx");
      await store.record({ path: target, name: `file-${index}.docx`, modifiedAtMs: index });
    }
    const listed = await store.list();
    expect(listed).toHaveLength(3);
    expect(listed.map((entry) => entry.name)).toEqual(["file-4.docx", "file-3.docx", "file-2.docx"]);
    const shortened = shortenDirectory(join(directory, "folder", "file.docx"));
    expect(shortened).toBe(`…${process.platform === "win32" ? "\\" : "/"}${directory.split(/[\\/]/).filter(Boolean).at(-1)}${process.platform === "win32" ? "\\" : "/"}folder`);
  });
});
