import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readZip, writeZip, ZipError } from "./zip.ts";

// Build a one-entry zip by hand so the central directory can lie about sizes.
function rawZip(entries: { name: string; data: Uint8Array; method: 0 | 8; claimedUncompressed?: number }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, entry.method, true);
    lv.setUint32(18, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, entry.method, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.claimedUncompressed ?? entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    parts.push(local, entry.data);
    central.push(cd);
    offset += local.length + entry.data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, eocd];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of all) { out.set(part, at); at += part.length; }
  return out;
}

const reasonOf = (run: () => unknown): string | undefined => {
  try { run(); } catch (error) { return error instanceof ZipError ? error.reason : "other"; }
  return undefined;
};

describe("readZip fixed bounds (server default)", () => {
  it("refuses an entry that claims more than the fixed ceiling", () => {
    const bomb = rawZip([{ name: "a.xml", data: deflateRawSync(new Uint8Array(10)), method: 8, claimedUncompressed: 600 << 20 }]);
    expect(reasonOf(() => readZip(bomb))).toBe("zip_too_large");
  });
});

describe("readZip proportional bounds (desktop local files)", () => {
  it("reads a legitimate package larger than the fixed ceiling's input-derived share", () => {
    const stored = writeZip([{ path: "big.bin", data: new Uint8Array(8 << 20) }]);
    expect(readZip(stored, "proportional").get("big.bin")?.length).toBe(8 << 20);
  });

  it("refuses an entry whose claimed size is far beyond the compressed size", () => {
    const bomb = rawZip([{ name: "a.xml", data: deflateRawSync(new Uint8Array(10)), method: 8, claimedUncompressed: 900 << 20 }]);
    expect(reasonOf(() => readZip(bomb, "proportional"))).toBe("zip_too_large");
  });

  it("refuses a lying header whose real inflate output exceeds the claim", () => {
    const real = deflateRawSync(new Uint8Array(4 << 20));
    const lying = rawZip([{ name: "a.xml", data: real, method: 8, claimedUncompressed: 1024 }]);
    expect(reasonOf(() => readZip(lying, "proportional"))).toBe("zip_too_large");
  });

  it("refuses a package that declares too many entries", () => {
    const entries = Array.from({ length: 20001 }, (_, i) => ({ name: "e" + i, data: new Uint8Array(0), method: 0 as const }));
    expect(reasonOf(() => readZip(rawZip(entries), "proportional"))).toBe("zip_too_large");
  });
});
