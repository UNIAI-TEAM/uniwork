import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isInitRecovery } from "./docs-frame-protocol";
import { endOfficeDraftSession, getOfficeDraftKey, officeDraftScope } from "./draft-session-key";

type KeyModule = typeof import("./draft-session-key");

const DRAFTS_DB = "uniwork-office-frame-drafts";
const G3_DB = "uniwork-office-drafts";

/** A fake IDBFactory whose deleteDatabase answers with the given event (no open: the host falls back to a memory key). */
function stubDeleteOnly(answer: "onsuccess" | "onerror" | "onblocked" = "onsuccess", open?: () => never) {
  const deleteDatabase = vi.fn((_name: string) => {
    const request: Record<string, (() => void) | null> = { onsuccess: null, onerror: null, onblocked: null };
    queueMicrotask(() => request[answer]?.());
    return request;
  });
  vi.stubGlobal("indexedDB", { deleteDatabase, open });
  return deleteDatabase;
}

/** A page reload or a second tab: the same IndexedDB, a module with no memory of the first. */
async function freshPage(): Promise<KeyModule> {
  vi.resetModules();
  return import("./draft-session-key");
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function openDb(name: string, version?: number): Promise<IDBDatabase> {
  const open = indexedDB.open(name, version);
  open.onupgradeneeded = () => {
    if (name === G3_DB) open.result.createObjectStore("drafts");
  };
  return request(open);
}

async function storedKey(userId: string): Promise<unknown> {
  const db = await openDb(DRAFTS_DB, 1);
  try {
    return await request(db.transaction("keys").objectStore("keys").get(userId));
  } finally {
    db.close();
  }
}

async function databaseNames(): Promise<string[]> {
  return (await indexedDB.databases()).map((d) => d.name ?? "");
}

async function seal(key: CryptoKey, text: string): Promise<{ iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv, data: await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)) };
}

async function open(key: CryptoKey, sealed: { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }): Promise<string> {
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv }, key, sealed.data));
}

describe("office draft session key", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
  });
  afterEach(async () => {
    await endOfficeDraftSession();
    vi.unstubAllGlobals();
  });

  it("is a non-extractable AES-GCM 256 key for encrypt/decrypt", async () => {
    const key = await getOfficeDraftKey("u1");
    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect([...key.usages].sort()).toEqual(["decrypt", "encrypt"]);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("returns the same key while the page lives (a frame reload gets it again)", async () => {
    const first = await getOfficeDraftKey("u1");
    expect(await getOfficeDraftKey("u1")).toBe(first);
  });

  it("persists the key as a CryptoKey record of the user in the keys store", async () => {
    await getOfficeDraftKey("u1");
    expect(await storedKey("u1")).toBeInstanceOf(CryptoKey);
    expect(await storedKey("u2")).toBeUndefined();
  });

  it("creates both stores, so the frame (which opens the database at version 1) finds its drafts store", async () => {
    await getOfficeDraftKey("u1");
    const db = await openDb(DRAFTS_DB, 1);
    expect([...db.objectStoreNames].sort()).toEqual(["drafts", "keys"]);
    db.close();
  });

  it("survives a page reload: the same key comes back, still non-extractable", async () => {
    const first = await getOfficeDraftKey("u1");
    const sealed = await seal(first, "draft text");
    const reloaded = await freshPage();
    const second = await reloaded.getOfficeDraftKey("u1");
    expect(second.extractable).toBe(false);
    expect(await open(second, sealed)).toBe("draft text");
    await expect(crypto.subtle.exportKey("raw", second)).rejects.toThrow();
  });

  it("two tabs racing on first use end up with the same key", async () => {
    const tabA = await freshPage();
    const tabB = await freshPage();
    const [a, b] = await Promise.all([tabA.getOfficeDraftKey("u1"), tabB.getOfficeDraftKey("u1")]);
    expect(await open(b, await seal(a, "from a"))).toBe("from a");
    expect(await open(a, await seal(b, "from b"))).toBe("from b");
  });

  it("generates a new key after the session ends: the old drafts cannot be read", async () => {
    const first = await getOfficeDraftKey("u1");
    const sealed = await seal(first, "old draft");
    await endOfficeDraftSession();
    const second = await getOfficeDraftKey("u1");
    expect(second).not.toBe(first);
    await expect(open(second, sealed)).rejects.toThrow();
  });

  it("sign-out deletes the whole frame database and leaves the G3 drafts database alone", async () => {
    const g3 = await openDb(G3_DB, 1);
    await request(g3.transaction("drafts", "readwrite").objectStore("drafts").put("kept", "doc1"));
    g3.close();
    await getOfficeDraftKey("u1");
    expect(await databaseNames()).toContain(DRAFTS_DB);
    await endOfficeDraftSession();
    expect(await databaseNames()).not.toContain(DRAFTS_DB);
    const again = await openDb(G3_DB, 1);
    expect(await request(again.transaction("drafts").objectStore("drafts").get("doc1"))).toBe("kept");
    again.close();
  });

  it("a different user switches the session: a different key, the old key record gone, the new one stored", async () => {
    const first = await getOfficeDraftKey("u1");
    const sealed = await seal(first, "u1 draft");
    const second = await getOfficeDraftKey("u2");
    expect(second).not.toBe(first);
    await expect(open(second, sealed)).rejects.toThrow();
    expect(await storedKey("u1")).toBeUndefined();
    expect(await storedKey("u2")).toBeInstanceOf(CryptoKey);
  });

  it("a switch while the first user's key is still loading does not wipe the new user's key", async () => {
    const first = getOfficeDraftKey("u1");
    const second = await getOfficeDraftKey("u2");
    await first;
    expect(await storedKey("u1")).toBeUndefined();
    expect(await storedKey("u2")).toBeInstanceOf(CryptoKey);
    const reloaded = await freshPage();
    expect(await open(await reloaded.getOfficeDraftKey("u2"), await seal(second, "kept"))).toBe("kept");
  });

  it("a user who signs in again after a switch gets a new key, not the stored one", async () => {
    const first = await getOfficeDraftKey("u1");
    await getOfficeDraftKey("u2");
    const back = await getOfficeDraftKey("u1");
    await expect(open(back, await seal(first, "x"))).rejects.toThrow();
  });

  it.each(["onsuccess", "onerror", "onblocked"] as const)("ending the session deletes the drafts database and settles on %s", async (answer) => {
    const deleteDatabase = stubDeleteOnly(answer);
    await expect(endOfficeDraftSession()).resolves.toBeUndefined();
    expect(deleteDatabase).toHaveBeenCalledTimes(1);
    expect(deleteDatabase).toHaveBeenCalledWith(DRAFTS_DB);
    expect(deleteDatabase).not.toHaveBeenCalledWith(G3_DB);
  });

  it("settles without IndexedDB or when the delete throws", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(endOfficeDraftSession()).resolves.toBeUndefined();
    vi.stubGlobal("indexedDB", { deleteDatabase: () => { throw new Error("SecurityError"); } });
    await expect(endOfficeDraftSession()).resolves.toBeUndefined();
  });

  it.each([
    ["is missing", () => vi.stubGlobal("indexedDB", undefined)],
    ["has no open", () => stubDeleteOnly()],
    ["refuses to open", () => stubDeleteOnly("onsuccess", () => { throw new Error("SecurityError"); })],
  ])("falls back to a memory key when IndexedDB %s: stable in the page, new after a reload", async (_label, stub) => {
    stub();
    const first = await getOfficeDraftKey("u1");
    expect(first.extractable).toBe(false);
    expect(await getOfficeDraftKey("u1")).toBe(first);
    const reloaded = await freshPage();
    await expect(open(await reloaded.getOfficeDraftKey("u1"), await seal(first, "x"))).rejects.toThrow();
  });

  it("scopes drafts by user and document", () => {
    expect(officeDraftScope("u1", "doc1")).toBe("u1:doc1");
  });

  it("the init recovery validator wants a CryptoKey and a non-empty scope", async () => {
    const key = await getOfficeDraftKey("u1");
    expect(isInitRecovery({ key, scope: "u1:doc1" })).toBe(true);
    expect(isInitRecovery({ key, scope: "" })).toBe(false);
    expect(isInitRecovery({ key: new Uint8Array(32), scope: "u1:doc1" })).toBe(false);
    expect(isInitRecovery({ key: {}, scope: "u1:doc1" })).toBe(false);
    expect(isInitRecovery(null)).toBe(false);
  });
});
