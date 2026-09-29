import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDraftKeyUnwrapPort } from "@uniwork/core/office/draft-key-port";
import { createDraftKeyProvider } from "./draft-key-provider";

const identity = {
  deploymentId: "deployment-test",
  accountId: "account-a",
  organizationId: "org-a",
  workspaceId: "workspace-a",
  documentId: "document-a",
  base: { revision: "r-1", version: "v-1" },
};
const session = { sessionId: "session-a", deploymentId: "deployment-test", accountId: "account-a", generation: 1 };

/** A small IndexedDB host double that serializes readwrite transactions. */
class ConcurrentKeyDatabase {
  value: CryptoKey | undefined;
  tail = Promise.resolve();

  readonly db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    transaction: (_name: string, mode: "readonly" | "readwrite") => new ConcurrentKeyTransaction(this, mode),
    close: () => undefined,
  };

  open(): unknown {
    const request: any = { result: this.db, error: null };
    queueMicrotask(() => {
      request.onupgradeneeded?.({ target: request });
      request.onsuccess?.({ target: request });
    });
    return request;
  }
}

class ConcurrentKeyTransaction {
  private readonly ready: Promise<void>;
  private release: (() => void) | undefined;
  private wrote = false;

  onerror: (() => void) | undefined;
  onabort: (() => void) | undefined;

  constructor(private readonly database: ConcurrentKeyDatabase, mode: "readonly" | "readwrite") {
    if (mode === "readwrite") {
      this.ready = database.tail;
      database.tail = database.tail.then(
        () =>
          new Promise<void>((resolve) => {
            this.release = resolve;
          }),
      );
    } else {
      this.ready = Promise.resolve();
    }
  }

  objectStore(): { get: (key: string) => any; put: (value: CryptoKey, key: string) => any } {
    return {
      get: (_key: string) => this.request(() => this.database.value, false),
      put: (value: CryptoKey, _key: string) => {
        this.wrote = true;
        return this.request(() => {
          this.database.value = value;
        }, true);
      },
    };
  }

  private request(run: () => unknown, write: boolean): any {
    const request: any = { result: undefined, error: null };
    void this.ready.then(() => {
      queueMicrotask(() => {
        try {
          request.result = run();
          request.onsuccess?.({ target: request });
          if (!write) {
            queueMicrotask(() => {
              if (!this.wrote) this.finish();
            });
          }
        } catch (error) {
          request.error = error;
          request.onerror?.({ target: request });
          this.onerror?.();
          this.finish();
        }
        if (write) this.finish();
      });
    });
    return request;
  }

  private finish(): void {
    const release = this.release;
    this.release = undefined;
    release?.();
  }
}

async function wrappingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"]);
}

const originalIndexedDb = globalThis.indexedDB;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
});

describe("browser draft key provider", () => {
  it("encrypts with a random per-draft key and recovers through the unwrap port", async () => {
    const port = createFakeDraftKeyUnwrapPort();
    const provider = createDraftKeyProvider({ port, wrappingKey: await wrappingKey() });
    const first = await provider.encrypt({ identity, draftId: "draft-a", generation: 1, plaintext: new TextEncoder().encode("secret") });
    const second = await provider.encrypt({ identity, draftId: "draft-a", generation: 1, plaintext: new TextEncoder().encode("secret") });
    expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(first.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    port.setResponse({ status: "unwrapped", wrappedKey: first.wrappedKey });
    const recovered = await provider.decrypt({ session, identity, draftId: "draft-a", generation: 1, checksum: first.checksum, ciphertext: first.ciphertext, wrappedKey: first.wrappedKey, liveAccess: "edit" });
    expect([...recovered]).toEqual([...new TextEncoder().encode("secret")]);
    expect(port.requests[0]).toMatchObject({ draftId: "draft-a", generation: 1 });
  });

  it("fails closed for ACL, conflict, malformed responses, and AAD mismatch", async () => {
    const port = createFakeDraftKeyUnwrapPort({ status: "blocked", reason: "edit_acl_missing" });
    const provider = createDraftKeyProvider({ port, wrappingKey: await wrappingKey() });
    const encrypted = await provider.encrypt({ identity, draftId: "draft-a", generation: 1, plaintext: new Uint8Array([1, 2, 3]) });
    await expect(provider.recover({ session, identity, draftId: "draft-a", generation: 1, checksum: encrypted.checksum, ciphertext: encrypted.ciphertext, wrappedKey: encrypted.wrappedKey, liveAccess: "edit" })).resolves.toEqual({ status: "blocked", reason: "edit_acl_missing" });
    port.setResponse({ status: "conflict", currentBase: { revision: "r-2", version: "v-2" }, draftBase: identity.base });
    await expect(provider.recover({ session, identity, draftId: "draft-a", generation: 1, checksum: encrypted.checksum, ciphertext: encrypted.ciphertext, wrappedKey: encrypted.wrappedKey, liveAccess: "edit" })).resolves.toMatchObject({ status: "conflict" });
    port.setResponse({ status: "unexpected" });
    await expect(provider.recover({ session, identity, draftId: "draft-a", generation: 1, checksum: encrypted.checksum, ciphertext: encrypted.ciphertext, wrappedKey: encrypted.wrappedKey, liveAccess: "edit" })).resolves.toEqual({ status: "locked", code: "draft_recovery_locked" });
    port.setResponse({ status: "unwrapped", wrappedKey: encrypted.wrappedKey });
    await expect(provider.recover({ session, identity: { ...identity, base: { revision: "r-other", version: "v-1" } }, draftId: "draft-a", generation: 1, checksum: encrypted.checksum, ciphertext: encrypted.ciphertext, wrappedKey: encrypted.wrappedKey, liveAccess: "edit" })).resolves.toEqual({ status: "locked", code: "draft_recovery_locked" });
  });

  it("requires live edit access and clears registered memory callbacks", async () => {
    const port = createFakeDraftKeyUnwrapPort();
    const provider = createDraftKeyProvider({ port, wrappingKey: await wrappingKey() });
    const encrypted = await provider.encrypt({ identity, draftId: "draft-a", generation: 1, plaintext: new Uint8Array([1]) });
    await expect(provider.recover({ session, identity, draftId: "draft-a", generation: 1, checksum: encrypted.checksum, ciphertext: encrypted.ciphertext, wrappedKey: encrypted.wrappedKey, liveAccess: "none" })).resolves.toEqual({ status: "blocked", reason: "edit_acl_missing" });
    const cleanup = vi.fn();
    provider.registerCleanup(cleanup);
    await provider.clearMemory();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("maps WebCrypto encryption failures to a typed storage error", async () => {
    const port = createFakeDraftKeyUnwrapPort();
    const provider = createDraftKeyProvider({ port, wrappingKey: await wrappingKey() });
    const generateKey = vi.spyOn(crypto.subtle, "generateKey").mockRejectedValueOnce(new Error("crypto unavailable"));
    await expect(provider.encrypt({ identity, draftId: "draft-a", generation: 1, plaintext: new Uint8Array([1]) })).rejects.toMatchObject({ code: "storage_unavailable" });
    generateKey.mockRestore();
  });

  it("rejects a session without a live generation", async () => {
    const port = createFakeDraftKeyUnwrapPort();
    const provider = createDraftKeyProvider({ port, wrappingKey: await wrappingKey() });
    const encrypted = await provider.encrypt({ identity, draftId: "draft-a", generation: 1, plaintext: new Uint8Array([1]) });
    await expect(provider.recover({ session: { ...session, generation: 0 }, identity, draftId: "draft-a", generation: 1, checksum: encrypted.checksum, ciphertext: encrypted.ciphertext, wrappedKey: encrypted.wrappedKey, liveAccess: "edit" })).rejects.toThrow("invalid draft session");
  });

  it("adopts the first wrapping key across two providers and after clearMemory", async () => {
    const database = new ConcurrentKeyDatabase();
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open: () => database.open() } });
    const port = createFakeDraftKeyUnwrapPort();
    const providerA = createDraftKeyProvider({ port, databaseName: "concurrent-draft" });
    const providerB = createDraftKeyProvider({ port, databaseName: "concurrent-draft" });
    const encrypted = await Promise.all([
      providerA.encrypt({ identity, draftId: "draft-a", generation: 1, plaintext: new TextEncoder().encode("secret") }),
      providerB.encrypt({ identity, draftId: "draft-b", generation: 1, plaintext: new TextEncoder().encode("secret") }),
    ]);

    port.setResponse({ status: "unwrapped", wrappedKey: encrypted[0].wrappedKey });
    const request = { session, identity, draftId: "draft-a", generation: 1, checksum: encrypted[0].checksum, ciphertext: encrypted[0].ciphertext, wrappedKey: encrypted[0].wrappedKey, liveAccess: "edit" as const };
    expect([...await providerB.decrypt(request)]).toEqual([...new TextEncoder().encode("secret")]);

    await providerB.clearMemory();
    expect([...await providerB.decrypt(request)]).toEqual([...new TextEncoder().encode("secret")]);
  });
});
