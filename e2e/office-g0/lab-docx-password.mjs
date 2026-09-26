// DOC-003 lab host (UNI-667): password-protected DOCX.
//
// The desktop main process detects an ECMA-376 encrypted package before the renderer sees any
// bytes and answers the open with `{ needsPassword, path, name }` (bootstrap-source
// apps/docs/src/main/docs-main.ts:2622-2630); the renderer then shows its password prompt and
// retries through `docs:open-decrypt` (docs-main.ts:3336-3354, App.tsx:1870-1885). The lab used to
// hand the CFB container to the renderer as if it were a zip, parseDocx threw, and the boot path
// fell back to a blank Untitled.docx (App.tsx:1788) - a silent fallback, not a result.
//
// This module is the lab's half of that contract:
//   * detection uses the same two markers as docx-encryption.ts (CFB magic + an EncryptedPackage
//     stream name), so the lab refuses exactly what the desktop host would prompt for;
//   * decryption uses the same third-party implementation the desktop host pins
//     (officecrypto-tool), resolved from the prepared source root, never vendored here;
//   * failures carry the desktop reasons ('wrong-password' | 'unsupported'), so the renderer's
//     own error strings are shown instead of a lab-invented message.
// The lab never re-encrypts: a session that opened an encrypted package refuses every docs save
// (lab-server.mjs `encrypted_save_unsupported`) rather than writing the document as plaintext.
//
// Node 22 built-ins only.

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ENCRYPTED_STREAM_UTF16 = Buffer.from('EncryptedPackage', 'utf16le');

/** ECMA-376 encrypted OOXML: CFB magic plus an EncryptedPackage stream in the directory. */
export function isEncryptedDocx(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 8) return false;
  return bytes.subarray(0, 8).equals(CFB_MAGIC) && bytes.includes(ENCRYPTED_STREAM_UTF16);
}

export class DocxDecryptError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'DocxDecryptError';
    this.reason = reason;
  }
}

/**
 * Binds the decryptor to the prepared source's own officecrypto-tool. Returns null when the lab
 * was started without a source root or the package is absent, so the caller answers a named
 * 'unsupported' refusal instead of pretending the password was checked.
 */
export function createDocxDecryptor({ sourceRoot }) {
  if (typeof sourceRoot !== 'string' || sourceRoot.length === 0) return null;
  const manifest = join(sourceRoot, 'package.json');
  if (!existsSync(manifest)) return null;
  let officeCrypto;
  let version = null;
  try {
    const requireFromSource = createRequire(manifest);
    officeCrypto = requireFromSource('officecrypto-tool');
    version = requireFromSource('officecrypto-tool/package.json').version ?? null;
  } catch {
    return null;
  }
  const decrypt = async (bytes, password) => {
    if (typeof password !== 'string' || password.length === 0) {
      throw new DocxDecryptError('wrong-password', 'a password is required');
    }
    try {
      return Buffer.from(await officeCrypto.decrypt(bytes, { password }));
    } catch (error) {
      // Same split as docx-encryption.ts decryptDocx: a verifier mismatch reprompts, anything
      // else (an exotic scheme) is a named unsupported refusal.
      const message = String(error?.message ?? error);
      if (message.includes('password is incorrect')) throw new DocxDecryptError('wrong-password', message);
      throw new DocxDecryptError('unsupported', message);
    }
  };
  return { decrypt, library: 'officecrypto-tool', version };
}
