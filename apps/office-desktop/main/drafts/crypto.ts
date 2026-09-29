import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { DraftIdentity } from "../../../../packages/core/office/draft-recovery";

interface EncryptedDraft {
  readonly nonce: Uint8Array;
  /** ciphertext followed by the 16-byte GCM authentication tag */
  readonly ciphertext: Uint8Array;
  readonly checksum: string;
}

/** The AAD is deliberately canonical and contains the complete identity/base
 * pair plus generation. Changing any field makes GCM authentication fail. */
function draftAssociatedData(identity: DraftIdentity, generation: number): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    deploymentId: identity.deploymentId,
    accountId: identity.accountId,
    organizationId: identity.organizationId,
    workspaceId: identity.workspaceId,
    documentId: identity.documentId,
    base: { revision: identity.base.revision, version: identity.base.version },
    generation,
  }));
}

export function encryptDraft(key: Uint8Array, plaintext: Uint8Array, identity: DraftIdentity, generation: number, source: (size: number) => Uint8Array = randomBytes): EncryptedDraft {
  assertKey(key);
  if (!Number.isSafeInteger(generation) || generation < 1) throw new TypeError("invalid draft generation");
  const nonce = source(12);
  if (nonce.byteLength !== 12) throw new TypeError("draft nonce source returned too few bytes");
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(draftAssociatedData(identity, generation)));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final(), cipher.getAuthTag()]);
  return { nonce: new Uint8Array(nonce), ciphertext: new Uint8Array(ciphertext), checksum: checksum(new Uint8Array(ciphertext)) };
}

export function decryptDraft(key: Uint8Array, encrypted: Pick<EncryptedDraft, "nonce" | "ciphertext">, identity: DraftIdentity, generation: number): Uint8Array {
  assertKey(key);
  if (encrypted.nonce.byteLength !== 12 || encrypted.ciphertext.byteLength < 16) throw new Error("draft ciphertext malformed");
  const body = encrypted.ciphertext.slice(0, -16);
  const tag = encrypted.ciphertext.slice(-16);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(encrypted.nonce));
  decipher.setAAD(Buffer.from(draftAssociatedData(identity, generation)));
  decipher.setAuthTag(Buffer.from(tag));
  return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(body)), decipher.final()]));
}

export function checksum(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

function assertKey(key: Uint8Array): void { if (key.byteLength !== 32) throw new TypeError("draft key must be 256 bits"); }
