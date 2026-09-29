import { draftKeyUnwrapResponseSchema, type DraftKeyUnwrapPort } from "../../../../packages/core/office/draft-key-port";
import {
  DraftRecoveryError,
  draftNamespace,
  type DraftBase,
  type DraftIdentity,
  type DraftSession,
} from "../../../../packages/core/office/draft-recovery";

const KEY_DATABASE_SUFFIX = "-office-draft-keys";
const KEY_STORE = "keys";
const WRAPPING_KEY_ID = "wrapping-key";

export interface DraftKeyProviderOptions {
  readonly port: DraftKeyUnwrapPort;
  readonly databaseName?: string;
  /** Test/host injection for a CryptoKey already held by the browser. */
  readonly wrappingKey?: CryptoKey;
}

export interface DraftEncryptionInput {
  readonly identity: DraftIdentity;
  readonly draftId: string;
  readonly generation: number;
  readonly plaintext: Uint8Array;
}

export interface DraftEncryptionOutput {
  /** IV is prefixed to ciphertext; it is never stored as a separate key. */
  readonly ciphertext: Uint8Array;
  /** AES-KW wrapped per-draft data key; it is safe to store beside ciphertext. */
  readonly wrappedKey: Uint8Array;
  readonly checksum: string;
}

export interface DraftDecryptionInput {
  readonly session: DraftSession;
  readonly identity: DraftIdentity;
  readonly draftId: string;
  readonly generation: number;
  readonly checksum: string;
  readonly ciphertext: Uint8Array;
  readonly wrappedKey: Uint8Array;
  readonly liveAccess: "edit" | "none";
}

export type DraftKeyRecovery =
  | { readonly status: "recovered"; readonly plaintext: Uint8Array }
  | { readonly status: "blocked"; readonly reason: "edit_acl_missing" }
  | { readonly status: "conflict"; readonly currentBase: DraftBase; readonly draftBase: DraftBase }
  | { readonly status: "locked"; readonly code: "draft_recovery_locked" };

export interface DraftKeyProvider {
  encrypt(input: DraftEncryptionInput): Promise<DraftEncryptionOutput>;
  recover(input: DraftDecryptionInput): Promise<DraftKeyRecovery>;
  decrypt(input: DraftDecryptionInput): Promise<Uint8Array>;
  clearMemory(): Promise<void>;
  registerCleanup(cleanup: () => void): () => void;
}

/**
 * WebCrypto implementation for G3-D1 Option B.
 *
 * A random AES-GCM data key is generated for each draft. Only its AES-KW
 * envelope is durable; the wrapping key is a non-exportable CryptoKey held by
 * IndexedDB. Decryption always asks the auth-owned port first, which binds the
 * operation to a live session and ACL decision.
 */
export function createDraftKeyProvider(options: DraftKeyProviderOptions): DraftKeyProvider {
  const databaseName = options.databaseName ?? "uniwork-office-drafts";
  let wrappingKeyPromise: Promise<CryptoKey> | undefined;
  let memoryKeys = new Set<CryptoKey>();
  const cleanups = new Set<() => void>();

  const getWrappingKey = async (): Promise<CryptoKey> => {
    if (options.wrappingKey) return options.wrappingKey;
    wrappingKeyPromise ??= loadOrCreateWrappingKey(databaseName + KEY_DATABASE_SUFFIX);
    return wrappingKeyPromise;
  };

  const provider: DraftKeyProvider = {
    async encrypt(input) {
      validateEncryptionInput(input);
      try {
        const cryptoObject = requireCrypto();
        const wrappingKey = await getWrappingKey();
        const dataKey = await cryptoObject.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"],
        );
        const iv = new Uint8Array(12);
        cryptoObject.getRandomValues(iv);
        const aad = associatedData(input.identity, input.generation);
        const encrypted = await cryptoObject.subtle.encrypt(
          { name: "AES-GCM", iv: bufferSource(iv), additionalData: bufferSource(aad) },
          dataKey,
          bufferSource(input.plaintext),
        );
        const wrapped = await cryptoObject.subtle.wrapKey("raw", dataKey, wrappingKey, "AES-KW");
        const ciphertext = concatBytes(iv, new Uint8Array(encrypted));
        const wrappedKey = new Uint8Array(wrapped);
        memoryKeys.add(dataKey);
        const checksum = await sha256Checksum(ciphertext);
        memoryKeys.delete(dataKey);
        return { ciphertext, wrappedKey, checksum };
      } catch (error) {
        if (error instanceof DraftRecoveryError) throw error;
        throw new DraftRecoveryError("storage_unavailable", "draft encryption failed");
      }
    },

    async recover(input) {
      validateDecryptionInput(input);
      if (input.liveAccess !== "edit") return { status: "blocked", reason: "edit_acl_missing" };
      const parsed = await unwrapEnvelope(options.port, input);
      if (parsed.status !== "unwrapped") return parsed;
      let dataKey: CryptoKey | undefined;
      try {
        const cryptoObject = requireCrypto();
        const wrappingKey = await getWrappingKey();
        dataKey = await cryptoObject.subtle.unwrapKey(
          "raw",
          bufferSource(parsed.wrappedKey),
          wrappingKey,
          "AES-KW",
          { name: "AES-GCM", length: 256 },
          false,
          ["decrypt"],
        );
        memoryKeys.add(dataKey);
        const bytes = input.ciphertext;
        if (bytes.byteLength <= 12) return { status: "locked", code: "draft_recovery_locked" };
        const plaintext = await cryptoObject.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: bufferSource(bytes.slice(0, 12)),
            additionalData: bufferSource(associatedData(input.identity, input.generation)),
          },
          dataKey,
          bufferSource(bytes.slice(12)),
        );
        const actualChecksum = await sha256Checksum(bytes);
        if (actualChecksum !== input.checksum) return { status: "locked", code: "draft_recovery_locked" };
        return { status: "recovered", plaintext: new Uint8Array(plaintext) };
      } catch {
        return { status: "locked", code: "draft_recovery_locked" };
      } finally {
        if (dataKey) memoryKeys.delete(dataKey);
      }
    },

    async decrypt(input) {
      const result = await provider.recover(input);
      if (result.status === "recovered") return result.plaintext;
      if (result.status === "blocked") {
        throw new DraftRecoveryError("forbidden", "live edit access is required to recover this draft");
      }
      if (result.status === "conflict") {
        throw new DraftRecoveryError("generation_conflict", "draft base no longer matches the current document");
      }
      throw new DraftRecoveryError("draft_recovery_locked", "draft key or ciphertext could not be authenticated");
    },

    async clearMemory() {
      memoryKeys = new Set<CryptoKey>();
      if (!options.wrappingKey) wrappingKeyPromise = undefined;
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch {
          // One host callback must not prevent the remaining memory cleanup.
        }
      }
    },

    registerCleanup(cleanup) {
      cleanups.add(cleanup);
      return () => cleanups.delete(cleanup);
    },
  };
  return provider;
}

async function unwrapEnvelope(port: DraftKeyUnwrapPort, input: DraftDecryptionInput): Promise<DraftKeyRecovery | { status: "unwrapped"; wrappedKey: Uint8Array }> {
  let raw: unknown;
  try {
    raw = await port.unwrap({
      session: input.session,
      identity: input.identity,
      draftId: input.draftId,
      generation: input.generation,
      checksum: input.checksum,
    });
  } catch {
    return { status: "locked", code: "draft_recovery_locked" };
  }
  const parsed = draftKeyUnwrapResponseSchema.safeParse(raw);
  if (!parsed.success) return { status: "locked", code: "draft_recovery_locked" };
  if (parsed.data.status !== "unwrapped") return parsed.data;
  try {
    return { status: "unwrapped", wrappedKey: decodeWrappedKey(parsed.data.wrappedKey) };
  } catch {
    return { status: "locked", code: "draft_recovery_locked" };
  }
}

function decodeWrappedKey(value: string | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value.slice();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) throw new Error("invalid wrapped key encoding");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function associatedData(identity: DraftIdentity, generation: number): Uint8Array {
  return new TextEncoder().encode(draftNamespace(identity) + `|generation:${generation}`);
}

function validateEncryptionInput(input: DraftEncryptionInput): void {
  validateIdentity(input.identity);
  if (!input.draftId || !Number.isSafeInteger(input.generation) || input.generation < 1) throw new TypeError("invalid draft generation");
}

function validateDecryptionInput(input: DraftDecryptionInput): void {
  validateIdentity(input.identity);
  if (!input.session.sessionId || !input.session.accountId || !input.session.deploymentId || !Number.isSafeInteger(input.session.generation) || input.session.generation < 1) throw new TypeError("invalid draft session");
  if (!input.draftId || !Number.isSafeInteger(input.generation) || input.generation < 1) throw new TypeError("invalid draft generation");
  if (input.ciphertext.byteLength === 0 || input.wrappedKey.byteLength === 0 || input.checksum.length === 0) throw new TypeError("invalid encrypted draft");
  if (input.session.accountId !== input.identity.accountId || input.session.deploymentId !== input.identity.deploymentId) throw new DraftRecoveryError("forbidden", "draft is outside the active session");
}

function validateIdentity(identity: DraftIdentity): void {
  const fields = [identity.deploymentId, identity.accountId, identity.organizationId, identity.workspaceId, identity.documentId, identity.base.revision, identity.base.version];
  if (fields.some((field) => field.length === 0)) throw new TypeError("draft identity parts must not be empty");
}

function requireCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) throw new DraftRecoveryError("storage_unavailable", "WebCrypto is unavailable in this browser");
  return globalThis.crypto;
}

async function sha256Checksum(bytes: Uint8Array): Promise<string> {
  const digest = await requireCrypto().subtle.digest("SHA-256", bufferSource(bytes));
  return "sha256:" + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function loadOrCreateWrappingKey(databaseName: string): Promise<CryptoKey> {
  if (typeof indexedDB === "undefined") return Promise.reject(new DraftRecoveryError("storage_unavailable", "IndexedDB is unavailable in this browser"));
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(databaseName, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(KEY_STORE);
    open.onerror = () => reject(new DraftRecoveryError("storage_unavailable", "could not open the draft key store"));
    open.onblocked = () => reject(new DraftRecoveryError("storage_unavailable", "draft key store upgrade was blocked"));
    open.onsuccess = () => {
      const db = open.result;
      // Generate outside the transaction, then atomically get-and-put-if-absent.
      // Concurrent tabs therefore adopt the first durable key instead of
      // retaining a key that lost the race to persist.
      void requireCrypto().subtle.generateKey({ name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"]).then((generated) => {
        const transaction = db.transaction(KEY_STORE, "readwrite");
        const store = transaction.objectStore(KEY_STORE);
        const read = store.get(WRAPPING_KEY_ID);
        let settled = false;
        const finish = (key: CryptoKey) => {
          if (settled) return;
          settled = true;
          resolve(key);
          db.close();
        };
        const fail = (message: string) => {
          if (settled) return;
          settled = true;
          reject(new DraftRecoveryError("storage_unavailable", message));
          db.close();
        };
        transaction.onerror = () => fail("could not persist the draft wrapping key");
        transaction.onabort = () => fail("could not persist the draft wrapping key");
        read.onerror = () => fail("could not read the draft wrapping key");
        read.onsuccess = () => {
          if (read.result) {
            finish(read.result as CryptoKey);
            return;
          }
          const write = store.put(generated, WRAPPING_KEY_ID);
          write.onerror = () => fail("could not persist the draft wrapping key");
          write.onsuccess = () => finish(generated as CryptoKey);
        };
      }).catch(() => {
        db.close();
        reject(new DraftRecoveryError("storage_unavailable", "WebCrypto could not create a wrapping key"));
      });
    };
  });
}

export const createWebCryptoDraftKeyProvider = createDraftKeyProvider;
