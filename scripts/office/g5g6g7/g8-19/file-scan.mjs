// G8-19 (UNI-1414) saved-file scan for G8-A01: a file saved from a UniWork
// editor, and every comment payload around it, must not carry the machine's
// account name. The fork never asks the OS for it (the author is the UniWork
// display name or the constant "User", fork 7d665a54
// apps/shell/src/main/uniwork-docs/modules.ts:49,60-69); this scanner reads
// the bytes back to prove it. Zip parts are inflated first (Office deflates
// them), a PDF's /T strings are decoded and its FlateDecode streams inflated.
// Pure but for scanFile(); the row modules call it after Save.
import { readFile } from "node:fs/promises";
import os from "node:os";
import { inflateRawSync, inflateSync } from "node:zlib";

import { isMainModule } from "../harness/lib.mjs";

export const MIN_NAME_LENGTH = 3;
const NEUTRAL_AUTHOR = "user";
const NEUTRAL_REASON = "the neutral author constant (fork apps/shell/src/main/uniwork-docs/modules.ts:49)";
const SHORT_REASON = `shorter than ${MIN_NAME_LENGTH} characters`;

/** Package parts that hold comments or their authors (re-read for the A01 artifact). */
const COMMENT_PART = /(^|\/)(comments\d*\.xml|commentsExtended\.xml|commentsIds\.xml|people\.xml|commentAuthors\.xml|threadedComment[^/]*\.xml|person[^/]*\.xml|comment\d*\.xml)$/i;

/** Splits names into the ones to scan for and the skipped ones, with the reason. */
export function filterNames(names) {
  const kept = [];
  const skipped = [];
  const seen = new Set();
  for (const raw of names) {
    const name = String(raw ?? "").trim();
    if (name === "") continue;
    if (name.toLowerCase() === NEUTRAL_AUTHOR) skipped.push({ name, reason: NEUTRAL_REASON });
    else if ([...name].length < MIN_NAME_LENGTH) skipped.push({ name, reason: SHORT_REASON });
    else if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      kept.push(name);
    }
  }
  return { names: kept, skipped };
}

/**
 * The machine account names to scan for: os.userInfo().username, os.hostname()
 * (and its short form before the first dot), USER, LOGNAME and USERNAME.
 * `sources` says where each kept name came from; skipped names are noted.
 */
export function machineNames({ userInfo = os.userInfo, hostname = os.hostname, env = process.env } = {}) {
  const found = [];
  const add = (value, source) => {
    const name = String(value ?? "").trim();
    if (name !== "") found.push({ name, source });
  };
  try {
    add(userInfo().username, "os.userInfo().username");
  } catch {
    // no passwd entry for the uid: the env names below still count
  }
  const host = String(hostname() ?? "");
  add(host, "os.hostname()");
  if (host.includes(".")) add(host.split(".")[0], "os.hostname() (short)");
  for (const key of ["USER", "LOGNAME", "USERNAME"]) add(env[key], key);

  const sources = {};
  const order = [];
  for (const { name, source } of found) {
    const key = order.find((n) => n.toLowerCase() === name.toLowerCase()) ?? name;
    if (!sources[key]) {
      sources[key] = [];
      order.push(key);
    }
    if (!sources[key].includes(source)) sources[key].push(source);
  }
  const { names, skipped } = filterNames(order);
  for (const s of skipped) s.sources = sources[s.name];
  return { names, skipped, sources: Object.fromEntries(names.map((n) => [n, sources[n]])) };
}

const lowerAscii = (b) => (b >= 0x41 && b <= 0x5a ? b + 0x20 : b);
const isWordByte = (b) => b !== undefined && ((b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f);

/** Every case-insensitive (ASCII) whole-word occurrence of `name` (UTF-8) in `buf`. */
function findAll(buf, name) {
  const needle = Buffer.from(name, "utf8").map(lowerAscii);
  const out = [];
  outer: for (let i = 0; i + needle.length <= buf.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (lowerAscii(buf[i + j]) !== needle[j]) continue outer;
    if (isWordByte(buf[i - 1]) || isWordByte(buf[i + needle.length])) continue;
    out.push(i);
  }
  return out;
}

function scanBuffer(buf, names, part, baseOffset = 0) {
  const hits = [];
  for (const name of names) for (const offset of findAll(buf, name)) hits.push({ name, part, offset: baseOffset + offset });
  return hits;
}

/** Hits of `names` in a text payload (a server body, a bridge reply); no filtering. */
export function scanText(text, names, part) {
  return scanBuffer(Buffer.from(String(text), "utf8"), names, part);
}

/** The parts of a zip package (stored and DEFLATE entries), read through the central directory. */
export function readZipParts(bytes) {
  const buf = Buffer.from(bytes);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip: no end of central directory");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const parts = [];
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central directory entry ${n}`);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + compressed);
    if (method === 0) parts.push({ name, data: Buffer.from(raw) });
    else if (method === 8) parts.push({ name, data: inflateRawSync(raw) });
    else throw new Error(`zip part ${name}: compression method ${method} not supported`);
  }
  return parts;
}

/** A PDF literal string starting at `start` (the "("), with escapes and nesting; [bytes, endIndex]. */
function readLiteral(buf, start) {
  const out = [];
  let depth = 0;
  for (let i = start; i < buf.length; i += 1) {
    const c = buf[i];
    if (c === 0x5c) {
      const n = buf[i + 1];
      const map = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c };
      if (n >= 0x30 && n <= 0x37) {
        let oct = "";
        let k = i + 1;
        while (k < i + 4 && buf[k] >= 0x30 && buf[k] <= 0x37) oct += String.fromCharCode(buf[k++]);
        out.push(parseInt(oct, 8) & 0xff);
        i = k - 1;
      } else if (n === 0x0d || n === 0x0a) {
        i += n === 0x0d && buf[i + 2] === 0x0a ? 2 : 1;
      } else {
        out.push(map[n] ?? n);
        i += 1;
      }
      continue;
    }
    if (c === 0x28) {
      depth += 1;
      if (depth === 1) continue;
    } else if (c === 0x29) {
      depth -= 1;
      if (depth === 0) return [Buffer.from(out), i];
    }
    out.push(c);
  }
  return [Buffer.from(out), buf.length];
}

function decodePdfText(bytes) {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString("utf16le");
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString("utf8");
  return bytes.toString("latin1");
}

/** [start, end) of every stream's data, so a `/T` inside font or image bytes is not read as a key. */
function streamDataRanges(buf) {
  const ranges = [];
  let i = buf.indexOf("stream", 0, "latin1");
  while (i >= 0) {
    if (buf.toString("latin1", i - 3, i) === "end") {
      i = buf.indexOf("stream", i + 6, "latin1");
      continue;
    }
    const stop = buf.indexOf("endstream", i + 6, "latin1");
    if (stop < 0) {
      ranges.push([i + 6, buf.length]);
      break;
    }
    ranges.push([i + 6, stop]);
    i = buf.indexOf("stream", stop + 9, "latin1");
  }
  return ranges;
}

/** Every `/T` string of a PDF body (annotation author), decoded, with the offset of its `/T`. */
export function pdfTitleStrings(bytes) {
  const buf = Buffer.from(bytes);
  const inStream = streamDataRanges(buf);
  const out = [];
  let i = buf.indexOf("/T", 0, "latin1");
  while (i >= 0) {
    let k = i + 2;
    if (!isWordByte(buf[k]) && !inStream.some(([a, b]) => i >= a && i < b)) {
      while (buf[k] === 0x20 || buf[k] === 0x0a || buf[k] === 0x0d || buf[k] === 0x09) k += 1;
      if (buf[k] === 0x28) {
        const [raw] = readLiteral(buf, k);
        out.push({ offset: i, value: decodePdfText(raw) });
      } else if (buf[k] === 0x3c && buf[k + 1] !== 0x3c) {
        const close = buf.indexOf(0x3e, k);
        const hex = buf.toString("latin1", k + 1, close < 0 ? buf.length : close).replace(/[^0-9a-f]/gi, "");
        out.push({ offset: i, value: decodePdfText(Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex")) });
      }
    }
    i = buf.indexOf("/T", i + 2, "latin1");
  }
  return out;
}

/** The FlateDecode streams of a PDF, inflated, with the offset of their data. */
function pdfStreams(buf) {
  const out = [];
  let i = buf.indexOf("stream", 0, "latin1");
  while (i >= 0) {
    if (buf.toString("latin1", i - 3, i) !== "end") {
      let start = i + 6;
      if (buf[start] === 0x0d) start += 1;
      if (buf[start] === 0x0a) start += 1;
      const stop = buf.indexOf("endstream", start, "latin1");
      if (stop < 0) break;
      const dict = buf.toString("latin1", Math.max(0, i - 400), i);
      if (/\/FlateDecode/.test(dict.slice(dict.lastIndexOf("<<")))) {
        try {
          out.push({ offset: start, data: inflateSync(buf.subarray(start, stop)) });
        } catch {
          // a damaged or truncated stream: the raw-byte scan still covers it
        }
      }
      i = buf.indexOf("stream", stop + 9, "latin1");
    } else {
      i = buf.indexOf("stream", i + 6, "latin1");
    }
  }
  return out;
}

function titleHits(titles, names, offsetBase = 0) {
  const hits = [];
  for (const t of titles) {
    for (const name of names) if (scanText(t.value, [name], "pdf:/T").length > 0) hits.push({ name, part: "pdf:/T", offset: offsetBase + t.offset, value: t.value });
  }
  return hits;
}

/**
 * Scans saved file bytes for `names`: a zip package part by part (inflated),
 * a PDF as raw bytes + decoded /T strings + inflated streams, anything else as
 * raw bytes. Names under 3 characters and "User" are skipped and listed.
 * -> { kind, names, skipped, parts, commentParts, hits: [{name, part, offset}] }
 */
export function scanForNames(bytes, rawNames) {
  const buf = Buffer.from(bytes);
  const { names, skipped } = filterNames(rawNames);
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
    const parts = readZipParts(buf);
    return {
      kind: "zip",
      names,
      skipped,
      parts: parts.map((p) => p.name),
      commentParts: parts.map((p) => p.name).filter((n) => COMMENT_PART.test(n)),
      hits: parts.flatMap((p) => scanBuffer(p.data, names, p.name)),
    };
  }
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    const streams = pdfStreams(buf);
    const titles = pdfTitleStrings(buf);
    const hits = [...scanBuffer(buf, names, "pdf:raw"), ...titleHits(titles, names)];
    for (const s of streams) {
      const part = `pdf:stream@${s.offset}`;
      hits.push(...scanBuffer(s.data, names, part), ...titleHits(pdfTitleStrings(s.data), names).map((h) => ({ ...h, part, stream: true })));
    }
    return { kind: "pdf", names, skipped, parts: ["pdf:raw", "pdf:/T", ...streams.map((s) => `pdf:stream@${s.offset}`)], commentParts: titles.length > 0 ? ["pdf:/T"] : [], titles: titles.length, hits };
  }
  return { kind: "raw", names, skipped, parts: ["raw"], commentParts: [], hits: scanBuffer(buf, names, "raw") };
}

/** scanForNames() on a file on disk; the path is the caller's (never printed here). */
export async function scanFile(path, names) {
  return scanForNames(await readFile(path), names);
}

if (isMainModule({ moduleUrl: import.meta.url })) {
  // node file-scan.mjs <file>: the scan of one saved file against this machine's names, as JSON
  const file = process.argv[2];
  if (!file) {
    process.stderr.write("usage: node file-scan.mjs <saved-file>\n");
    process.exit(2);
  }
  const machine = machineNames();
  const result = await scanFile(file, machine.names);
  process.stdout.write(`${JSON.stringify({ machine, ...result }, null, 2)}\n`);
  process.exit(result.hits.length === 0 ? 0 : 1);
}
