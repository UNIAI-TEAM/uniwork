// P0-1 (UNI-927) — browser Buffer for the vendored pptx closure.
//
// The upstream pptx engine/ops/render sources parse and patch XML through
// Buffer.from / Buffer.alloc / Buffer.concat and `buf.toString("utf8")`. The
// build script injects this module for the free `Buffer` identifier, so the
// shim only has to implement what that closure performs — every operation is
// pinned by scripts/office/build-pptx-browser.test.mjs against node's crypto,
// zlib and UTF-8 round trips.
//
// It extends Uint8Array, so every value that leaves here interops with the
// rest of the bundle (jszip, TextEncoder, the engine's own byte comparisons)
// without copying.

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8");

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesFromBase64(text: string): Uint8Array {
  const input = text.replace(/\s+/g, "");
  const padded = input.endsWith("==") ? input.slice(0, -2) : input.endsWith("=") ? input.slice(0, -1) : input;
  const out = new Uint8Array(Math.floor((padded.length * 3) / 4));
  let bitBuffer = 0;
  let bitCount = 0;
  let index = 0;
  for (const char of padded) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value < 0) throw new Error("buffer shim: invalid base64 input");
    bitBuffer = (bitBuffer << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out[index] = (bitBuffer >>> bitCount) & 0xff;
      index += 1;
    }
  }
  return index === out.length ? out : out.slice(0, index);
}

function bytesFromHex(text: string): Uint8Array {
  const out = new Uint8Array(text.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesFromBinary(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < out.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

class BrowserBuffer extends Uint8Array {
  override toString(encoding = "utf8"): string {
    if (encoding === "hex") {
      let out = "";
      for (const byte of this) out += byte.toString(16).padStart(2, "0");
      return out;
    }
    if (encoding === "base64") {
      let out = "";
      for (let i = 0; i < this.length; i += 3) {
        const a = this[i]!;
        const b = i + 1 < this.length ? this[i + 1]! : 0;
        const c = i + 2 < this.length ? this[i + 2]! : 0;
        out += BASE64_ALPHABET[a >> 2];
        out += BASE64_ALPHABET[((a & 3) << 4) | (b >> 4)];
        out += i + 1 < this.length ? BASE64_ALPHABET[((b & 15) << 2) | (c >> 6)] : "=";
        out += i + 2 < this.length ? BASE64_ALPHABET[c & 63] : "=";
      }
      return out;
    }
    if (encoding === "ascii" || encoding === "binary" || encoding === "latin1") {
      let out = "";
      for (const byte of this) out += String.fromCharCode(byte);
      return out;
    }
    return UTF8_DECODER.decode(this);
  }

  writeUInt32BE(value: number, offset = 0): number {
    this[offset] = (value >>> 24) & 0xff;
    this[offset + 1] = (value >>> 16) & 0xff;
    this[offset + 2] = (value >>> 8) & 0xff;
    this[offset + 3] = value & 0xff;
    return offset + 4;
  }
}

function from(value: string | ArrayLike<number> | ArrayBuffer | Uint8Array, encoding = "utf8"): BrowserBuffer {
  if (typeof value === "string") {
    if (encoding === "base64") return new BrowserBuffer(bytesFromBase64(value));
    if (encoding === "hex") return new BrowserBuffer(bytesFromHex(value));
    if (encoding === "ascii" || encoding === "binary" || encoding === "latin1") return new BrowserBuffer(bytesFromBinary(value));
    return new BrowserBuffer(UTF8_ENCODER.encode(value));
  }
  if (value instanceof ArrayBuffer) return new BrowserBuffer(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return new BrowserBuffer(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return new BrowserBuffer(value);
}

function alloc(size: number, fill = 0): BrowserBuffer {
  const buffer = new BrowserBuffer(size);
  if (fill !== 0) buffer.fill(fill);
  return buffer;
}

function concat(chunks: readonly Uint8Array[], totalLength?: number): BrowserBuffer {
  const length = totalLength ?? chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const buffer = new BrowserBuffer(length);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

/** jszip's browser shim probes Buffer support through `Buffer.isBuffer`. */
function isBuffer(value: unknown): boolean {
  return value instanceof BrowserBuffer;
}

export const Buffer = Object.assign(BrowserBuffer, { from, alloc, concat, isBuffer });
