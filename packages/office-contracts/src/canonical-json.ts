// Canonical JSON + byte helpers shared by every envelope/result consumer.
// Environment-neutral: Uint8Array only, WebCrypto for hashing (present in
// Node 20+ and every browser host).

/** Stable JSON: object keys sorted recursively, so two spellings of the same
 * payload produce one fingerprint. Arrays keep their order (edit order
 * matters). Ported from canonicalJson in engine-contract.mjs. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJson((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

/** SHA-256 over BYTES, never over a description of bytes. Async because the
 * environment-neutral implementation is WebCrypto. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export type StrictBase64Error =
  | "base64_alphabet"
  | "base64_padding"
  | "base64_length"
  | "base64_canonical";

/**
 * Strict base64 decoder. Lenient decoders (atob, Buffer.from) silently drop
 * characters outside the alphabet - the same permissiveness the DOC-005 store
 * review flagged - so a caller could smuggle bytes past a declared length
 * while the declared digest still matched the truncated buffer. Throws
 * {code, message} tagged objects so the caller maps them to the right wire
 * violation.
 */
export function decodeStrictBase64(text: string): Uint8Array {
  const fail = (code: StrictBase64Error, detail: string): never => {
    throw Object.assign(new Error(code + ": " + detail), { code });
  };
  if (text.length === 0) return new Uint8Array(0);
  if (/[^A-Za-z0-9+/=]/.test(text)) {
    fail("base64_alphabet", "character outside the base64 alphabet");
  }
  const pad = text.indexOf("=");
  if (pad !== -1) {
    if (pad < text.length - 2 || !/^={1,2}$/.test(text.slice(pad))) {
      fail("base64_padding", "padding must be terminal and one or two characters");
    }
    if (text.length % 4 !== 0) {
      fail("base64_padding", "padded base64 length must be a multiple of 4");
    }
  } else if (text.length % 4 === 1) {
    fail("base64_length", "unpadded base64 length cannot be 1 mod 4");
  }
  const body = pad === -1 ? text : text.slice(0, pad);
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (const ch of body) {
    acc = (acc << 6) | B64_ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n] = (acc >>> bits) & 0xff;
      n += 1;
    }
  }
  // Canonical-form check: re-encoding must reproduce the input modulo padding,
  // which rejects non-canonical encodings with unused bits set.
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) {
    fail("base64_canonical", "non-canonical base64 (unused bits or padding set)");
  }
  return out.subarray(0, n);
}

/** Base64 encode, environment-neutral. */
export function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1] as number | undefined;
    const c = bytes[i + 2] as number | undefined;
    out += B64_ALPHABET[a >> 2];
    out += B64_ALPHABET[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
    out += b === undefined ? "=" : B64_ALPHABET[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
    out += c === undefined ? "=" : B64_ALPHABET[c & 63];
  }
  return out;
}
