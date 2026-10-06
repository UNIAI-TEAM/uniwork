// P0-1 (UNI-927) — node:zlib browser shim for the vendored pptx closure.
//
// The only reachable use (pinned 09485f88) is
//   packages/pptx-engine/src/media-insert.ts:92
//     pngChunk('IDAT', deflateSync(raw))
// i.e. the IDAT stream of the solid-colour poster PNG `solidPng` builds for
// inserted audio/video. That output must stay a valid zlib stream or the
// saved deck will not open — so this is a real DEFLATE encoder (fixed-Huffman
// blocks with an LZ77 greedy match search), not a store-only stub. The unit
// test round-trips every shape through node:zlib inflateSync.
//
// Nothing else in the closure inflates, so only deflateSync is bound.

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const WINDOW = 32768;
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;
const HASH_MASK = HASH_SIZE - 1;
const CHAIN_LIMIT = 32;

/** LSB-first bit sink (DEFLATE packs Huffman codes MSB-first, extras LSB-first). */
class BitWriter {
  private buffer: Uint8Array;
  private length = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(capacity: number) {
    this.buffer = new Uint8Array(Math.max(64, capacity));
  }

  writeBits(value: number, count: number): void {
    for (let i = 0; i < count; i += 1) this.pushBit((value >>> i) & 1);
  }

  writeCode(code: number, count: number): void {
    for (let i = count - 1; i >= 0; i -= 1) this.pushBit((code >>> i) & 1);
  }

  private pushBit(bit: number): void {
    this.bitBuffer |= bit << this.bitCount;
    this.bitCount += 1;
    if (this.bitCount === 8) {
      this.pushByte(this.bitBuffer);
      this.bitBuffer = 0;
      this.bitCount = 0;
    }
  }

  private pushByte(byte: number): void {
    if (this.length === this.buffer.length) {
      const next = new Uint8Array(this.buffer.length * 2);
      next.set(this.buffer);
      this.buffer = next;
    }
    this.buffer[this.length] = byte;
    this.length += 1;
  }

  finish(): Uint8Array {
    if (this.bitCount > 0) this.pushByte(this.bitBuffer);
    return this.buffer.slice(0, this.length);
  }
}

function writeLiteral(writer: BitWriter, symbol: number): void {
  if (symbol <= 143) writer.writeCode(0x30 + symbol, 8);
  else if (symbol <= 255) writer.writeCode(0x190 + symbol - 144, 9);
  else if (symbol <= 279) writer.writeCode(symbol - 256, 7);
  else writer.writeCode(0xc0 + symbol - 280, 8);
}

function writeMatch(writer: BitWriter, length: number, distance: number): void {
  let lengthCode = LENGTH_BASE.length - 1;
  while (lengthCode > 0 && length < LENGTH_BASE[lengthCode]!) lengthCode -= 1;
  writeLiteral(writer, 257 + lengthCode);
  writer.writeBits(length - LENGTH_BASE[lengthCode]!, LENGTH_EXTRA[lengthCode]!);

  let distanceCode = DIST_BASE.length - 1;
  while (distanceCode > 0 && distance < DIST_BASE[distanceCode]!) distanceCode -= 1;
  writer.writeCode(distanceCode, 5);
  writer.writeBits(distance - DIST_BASE[distanceCode]!, DIST_EXTRA[distanceCode]!);
}

const HASH_SHIFT = 5;
const HASH_BITS_IN_KEY = 10;

function hashAt(bytes: Uint8Array, position: number): number {
  return (((bytes[position]! << HASH_BITS_IN_KEY) ^ (bytes[position + 1]! << HASH_SHIFT) ^ bytes[position + 2]!) & HASH_MASK) >>> 0;
}

/** Raw DEFLATE stream: one final fixed-Huffman block with greedy LZ77. */
function deflateRaw(bytes: Uint8Array): Uint8Array {
  const writer = new BitWriter(bytes.length + 64);
  writer.writeBits(1, 1);
  writer.writeBits(1, 2);
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(WINDOW).fill(-1);
  const chainMask = WINDOW - 1;
  const total = bytes.length;
  let position = 0;

  while (position < total) {
    let matchLength = 0;
    let matchDistance = 0;
    if (position + MIN_MATCH <= total) {
      const key = hashAt(bytes, position);
      const limit = Math.min(MAX_MATCH, total - position);
      let candidate = head[key]!;
      let chain = 0;
      while (candidate >= 0 && chain < CHAIN_LIMIT && position - candidate <= WINDOW) {
        let length = 0;
        while (length < limit && bytes[candidate + length] === bytes[position + length]) length += 1;
        if (length > matchLength) {
          matchLength = length;
          matchDistance = position - candidate;
          if (length >= limit) break;
        }
        const next = prev[candidate & chainMask]!;
        if (next >= candidate) break;
        candidate = next;
        chain += 1;
      }
      prev[position & chainMask] = head[key]!;
      head[key] = position;
    }
    if (matchLength >= MIN_MATCH) {
      writeMatch(writer, matchLength, matchDistance);
      const end = position + matchLength;
      position += 1;
      while (position < end) {
        if (position + MIN_MATCH <= total) {
          const key = hashAt(bytes, position);
          prev[position & chainMask] = head[key]!;
          head[key] = position;
        }
        position += 1;
      }
    } else {
      writeLiteral(writer, bytes[position]!);
      position += 1;
    }
  }
  writeLiteral(writer, 256);
  return writer.finish();
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let offset = 0; offset < bytes.length; offset += 5552) {
    const end = Math.min(offset + 5552, bytes.length);
    for (let i = offset; i < end; i += 1) {
      a += bytes[i]!;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * deflateSync(data[, options]) — zlib-wrapped DEFLATE, the shape node:zlib
 * produces. The level option is accepted for signature parity; the encoder is
 * a single-pass greedy one, so output is always valid but not level-tuned.
 */
export function deflateSync(data: Uint8Array, _options?: { level?: number }): Uint8Array {
  const raw = deflateRaw(data);
  const out = new Uint8Array(raw.length + 6);
  out[0] = 0x78;
  out[1] = 0x9c;
  out.set(raw, 2);
  const checksum = adler32(data);
  out[out.length - 4] = (checksum >>> 24) & 0xff;
  out[out.length - 3] = (checksum >>> 16) & 0xff;
  out[out.length - 2] = (checksum >>> 8) & 0xff;
  out[out.length - 1] = checksum & 0xff;
  return out;
}
