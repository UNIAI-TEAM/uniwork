import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isInitRecovery } from "./docs-frame-protocol";
import { endOfficeDraftSession, getOfficeDraftKey, officeDraftScope } from "./draft-session-key";

/** A fake IDBFactory whose deleteDatabase answers with the given event. */
function stubIndexedDB(answer: "onsuccess" | "onerror" | "onblocked" = "onsuccess") {
  const deleteDatabase = vi.fn((_name: string) => {
    const request: Record<string, (() => void) | null> = { onsuccess: null, onerror: null, onblocked: null };
    queueMicrotask(() => request[answer]?.());
    return request;
  });
  vi.stubGlobal("indexedDB", { deleteDatabase });
  return deleteDatabase;
}

describe("office draft session key", () => {
  beforeEach(() => {
    stubIndexedDB();
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

  it("returns the same key for the whole session (a frame reload gets it again)", async () => {
    const first = await getOfficeDraftKey("u1");
    expect(await getOfficeDraftKey("u1")).toBe(first);
  });

  it("generates a new key after the session ends", async () => {
    const first = await getOfficeDraftKey("u1");
    await endOfficeDraftSession();
    expect(await getOfficeDraftKey("u1")).not.toBe(first);
  });

  it("a different user switches the session: new key, drafts deleted", async () => {
    const deleteDatabase = stubIndexedDB();
    const first = await getOfficeDraftKey("u1");
    const second = await getOfficeDraftKey("u2");
    expect(second).not.toBe(first);
    expect(deleteDatabase).toHaveBeenCalledWith("uniwork-office-frame-drafts");
  });

  it.each(["onsuccess", "onerror", "onblocked"] as const)("ending the session deletes the drafts database and settles on %s", async (answer) => {
    const deleteDatabase = stubIndexedDB(answer);
    await expect(endOfficeDraftSession()).resolves.toBeUndefined();
    expect(deleteDatabase).toHaveBeenCalledTimes(1);
    expect(deleteDatabase).toHaveBeenCalledWith("uniwork-office-frame-drafts");
    expect(deleteDatabase).not.toHaveBeenCalledWith("uniwork-office-drafts");
  });

  it("settles without IndexedDB or when the delete throws", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(endOfficeDraftSession()).resolves.toBeUndefined();
    vi.stubGlobal("indexedDB", { deleteDatabase: () => { throw new Error("SecurityError"); } });
    await expect(endOfficeDraftSession()).resolves.toBeUndefined();
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
