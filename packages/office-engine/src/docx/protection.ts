// C3 (UNI-924): document protection — the two w:documentProtection /
// w:writeProtection ops, their validation, the pending-edit state the model
// carries into SaveOptions, and the Word 2013+ protection-password hash ported
// from the vendored packages/docx-engine/src/protection.ts (iterated SHA-512,
// algorithm sid 14):
//   h0 = SHA-512(salt || UTF-16LE(password))
//   hi = SHA-512(h(i-1) || LE32(i))  for i = 0..spinCount-1
//
// Security posture (this task is security-reviewed):
//  - the plaintext password is consumed here and is never logged, kept,
//    returned or sent anywhere; only the file-borne verifier (base64
//    hash/salt + spinCount) leaves this module
//  - a missing WebCrypto fails closed with a typed DocxEngineError; there is
//    deliberately no weaker fallback scheme
import { DocxEngineError, type DocProtection, type DocxSaveOptions, type WriteProtection } from "./engine";

/** The two protection ops the model's edit channel accepts (C3). */
export type DocxProtectionOp =
  | { op: "set_protection"; protection: DocProtection | null }
  | { op: "set_write_protection"; writeProtection: WriteProtection | null };

/** Whether an edit belongs to the protection area (the model's dispatch). */
export function isProtectionOp(edit: { op: string }): edit is DocxProtectionOp {
  return edit.op === "set_protection" || edit.op === "set_write_protection";
}

/** w:cryptAlgorithmSid 14 = SHA-512 — the only scheme this build hashes or
 * accepts back. */
const PROTECTION_ALGORITHM_SID = 14;

function requireProtectionCredentials(
  credentials: { hash?: unknown; salt?: unknown; spinCount?: unknown; algorithmSid?: unknown },
  what: string,
): void {
  if (credentials.hash !== undefined && (typeof credentials.hash !== "string" || credentials.hash.length === 0)) {
    throw new DocxEngineError("bad_protection", what + " hash must be a non-empty base64 string");
  }
  if (credentials.salt !== undefined && (typeof credentials.salt !== "string" || credentials.salt.length === 0)) {
    throw new DocxEngineError("bad_protection", what + " salt must be a non-empty base64 string");
  }
  if (credentials.spinCount !== undefined && (!Number.isInteger(credentials.spinCount) || (credentials.spinCount as number) < 1)) {
    throw new DocxEngineError("bad_protection", what + " spinCount must be a positive integer");
  }
  if (credentials.algorithmSid !== undefined && credentials.algorithmSid !== PROTECTION_ALGORITHM_SID) {
    throw new DocxEngineError(
      "bad_protection",
      what + " algorithmSid " + String(credentials.algorithmSid) + " is not the supported " + PROTECTION_ALGORITHM_SID,
    );
  }
}

/** Validate an editing restriction and return the copy the model stores. */
function requireDocProtection(protection: DocProtection, what: string): DocProtection {
  if (typeof protection.edit !== "string" || protection.edit.length === 0) {
    throw new DocxEngineError("bad_protection", what + " needs a non-empty edit mode");
  }
  if (typeof protection.enforced !== "boolean") {
    throw new DocxEngineError("bad_protection", what + " enforced must be boolean");
  }
  requireProtectionCredentials(protection, what);
  return { ...protection };
}

/** Validate a password-to-modify and return the stored copy. A spec the writer
 * would render as nothing (no recommended, no hash) is refused. */
function requireWriteProtection(writeProtection: WriteProtection, what: string): WriteProtection {
  if (writeProtection.recommended !== undefined && typeof writeProtection.recommended !== "boolean") {
    throw new DocxEngineError("bad_protection", what + " recommended must be boolean");
  }
  requireProtectionCredentials(writeProtection, what);
  const hasHash = typeof writeProtection.hash === "string" && writeProtection.hash.length > 0;
  if (writeProtection.recommended !== true && !hasHash) {
    throw new DocxEngineError("empty_protection", what + " needs recommended=true or a password hash");
  }
  return { ...writeProtection };
}

/** Pending protection edits (C3): a spec sets/replaces one tag, null removes
 * it, and an untouched tag never reaches SaveOptions — so word/settings.xml
 * keeps its exact bytes when nothing was edited. */
export class DocxProtectionEdits {
  private protection: DocProtection | null | undefined;
  private writeProtection: WriteProtection | null | undefined;

  constructor(private readonly onDirty: () => void) {}

  setProtection(protection: DocProtection | null): void {
    this.protection = protection === null ? null : requireDocProtection(protection, "set_protection");
    this.onDirty();
  }

  setWriteProtection(writeProtection: WriteProtection | null): void {
    this.writeProtection = writeProtection === null ? null : requireWriteProtection(writeProtection, "set_write_protection");
    this.onDirty();
  }

  /** The model's single entry for the two protection ops. */
  applyEdit(edit: DocxProtectionOp): void {
    switch (edit.op) {
      case "set_protection":
        return this.setProtection(edit.protection);
      case "set_write_protection":
        return this.setWriteProtection(edit.writeProtection);
    }
  }

  /** Only the edits the user made; both keys stay absent otherwise. Each call
   * returns a fresh copy, so a caller mutating the returned spec cannot reach
   * back into the model's stored edit. */
  saveOptions(): DocxSaveOptions {
    const options: DocxSaveOptions = {};
    if (this.protection !== undefined) {
      options.protection = this.protection === null ? null : { ...this.protection };
    }
    if (this.writeProtection !== undefined) {
      options.writeProtection = this.writeProtection === null ? null : { ...this.writeProtection };
    }
    return options;
  }

  clear(): void {
    this.protection = undefined;
    this.writeProtection = undefined;
  }
}

/** The verifier a save writes into the file (base64 hash + salt). */
export interface ProtectionCredentials {
  hash: string;
  salt: string;
  spinCount: number;
  algorithmSid: number;
}

/** w:cryptAlgorithmSid 14 = SHA-512 — the only scheme this build hashes. */
export const DOCX_PROTECTION_ALGORITHM_SID = 14;

const DEFAULT_SPIN_COUNT = 100000;
const SALT_BYTE_LENGTH = 16;
const SHA512_BYTE_LENGTH = 64;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    out[i * 2] = code & 0xff;
    out[i * 2 + 1] = code >> 8;
  }
  return out;
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

function subtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new DocxEngineError(
      "crypto_unavailable",
      "WebCrypto subtle is unavailable; a protection password cannot be hashed here",
    );
  }
  return subtle;
}

function requireSpinCount(spinCount: number): void {
  if (!Number.isInteger(spinCount) || spinCount < 1) {
    throw new DocxEngineError("bad_spin_count", "spinCount must be a positive integer, got " + String(spinCount));
  }
}

/** The raw iterated SHA-512 verifier bytes. Exported for the cross-build
 * compatibility vector test; the product surface calls hashProtectionPassword. */
export async function protectionHash(password: string, salt: Uint8Array, spinCount: number): Promise<Uint8Array> {
  requireSpinCount(spinCount);
  if (!(salt instanceof Uint8Array) || salt.length === 0) {
    throw new DocxEngineError("bad_salt", "protectionHash needs a non-empty salt");
  }
  const subtle = subtleCrypto();
  const digest = async (bytes: Uint8Array): Promise<Uint8Array> => {
    const out = await subtle.digest("SHA-512", bytes as BufferSource);
    return new Uint8Array(out);
  };
  const passwordBytes = utf16le(password);
  let hash = await digest(concat(salt, passwordBytes));
  passwordBytes.fill(0);
  const counter = new Uint8Array(4);
  const view = new DataView(counter.buffer);
  for (let i = 0; i < spinCount; i += 1) {
    view.setUint32(0, i, true);
    hash = await digest(concat(hash, counter));
  }
  counter.fill(0);
  if (hash.length !== SHA512_BYTE_LENGTH) {
    throw new DocxEngineError("crypto_unavailable", "SHA-512 returned " + hash.length + " bytes");
  }
  return hash;
}

/** Hash the desired protection password into the credentials the save writes
 * (random 16-byte salt, Word's default 100000 spin count). The plaintext is
 * never returned, stored or logged. */
export async function hashProtectionPassword(password: string, spinCount: number = DEFAULT_SPIN_COUNT): Promise<ProtectionCredentials> {
  if (typeof password !== "string" || password.length === 0) {
    throw new DocxEngineError("empty_password", "a protection password must not be empty");
  }
  requireSpinCount(spinCount);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new DocxEngineError("crypto_unavailable", "WebCrypto getRandomValues is unavailable; a salt cannot be generated here");
  }
  const salt = cryptoApi.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const hash = await protectionHash(password, salt, spinCount);
  const credentials: ProtectionCredentials = {
    hash: toBase64(hash),
    salt: toBase64(salt),
    spinCount,
    algorithmSid: DOCX_PROTECTION_ALGORITHM_SID,
  };
  hash.fill(0);
  salt.fill(0);
  return credentials;
}
