import { describe, expect, it, vi } from "vitest";
import { DocxAdapter } from "./docx/adapter";
import { PptxAdapter } from "./pptx/adapter";
import { writeZip } from "./node/convert/zip.ts";
import { scanZipBomb } from "./shared/zip-central.ts";
import { XlsxAdapter } from "./xlsx/adapter.ts";

interface FakeEntry {
  readonly name: string;
  readonly compressed: number;
  readonly uncompressed: number;
}

/** A header-only package: central directory and EOCD, no entry data. The
 *  pre-scan never reads past the directory, so this is all a bomb needs. */
function headerOnlyZip(entries: readonly FakeEntry[], opts: { entryCountField?: number; centralOffset?: number } = {}): Uint8Array {
  const parts: Uint8Array[] = [new TextEncoder().encode("PK\u0003\u0004")];
  const central: Uint8Array[] = [];
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    const cen = new Uint8Array(46 + name.length);
    const v = new DataView(cen.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint32(20, e.compressed, true);
    v.setUint32(24, e.uncompressed, true);
    v.setUint16(28, name.length, true);
    cen.set(name, 46);
    central.push(cen);
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(10, opts.entryCountField ?? entries.length, true);
  ev.setUint32(16, opts.centralOffset ?? 4, true);
  parts.push(...central, end);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const MIB = 1 << 20;
const bombs: Record<string, Uint8Array> = {
  "declared total far above 100x the input": headerOnlyZip([{ name: "a", compressed: 500, uncompressed: 400 * MIB }]),
  "an entry over 1 MiB at more than 100:1": headerOnlyZip([{ name: "a", compressed: 1000, uncompressed: 5 * MIB }]),
  "more than 20,000 entries": headerOnlyZip(Array.from({ length: 20001 }, (_, i) => ({ name: `e${i}`, compressed: 1, uncompressed: 1 }))),
  "a zip64 sentinel size": headerOnlyZip([{ name: "a", compressed: 10, uncompressed: 0xffffffff }]),
  "a zip64 sentinel entry count": headerOnlyZip([{ name: "a", compressed: 1, uncompressed: 1 }], { entryCountField: 0xffff }),
  "a central directory outside the input": headerOnlyZip([{ name: "a", compressed: 1, uncompressed: 1 }], { centralOffset: 0x7fffffff }),
};
const normal = writeZip([
  { path: "[Content_Types].xml", data: new TextEncoder().encode("<Types/>") },
  { path: "word/document.xml", data: new Uint8Array(2000).fill(65) },
]);

describe("scanZipBomb", () => {
  it.each(Object.entries(bombs))("refuses %s", (_name, bytes) => {
    expect(scanZipBomb(bytes)).not.toBeNull();
  });
  it("leaves a package with no end record to the upstream parser", () => {
    expect(scanZipBomb(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]))).toBeNull();
  });
  it("lets a normal package through", () => {
    expect(scanZipBomb(normal)).toBeNull();
  });
  it("lets a large honest package through: many entries within the proportional bound", () => {
    const entries = Array.from({ length: 12000 }, (_, i) => ({ name: `p${i}`, compressed: 40, uncompressed: 400 }));
    expect(scanZipBomb(headerOnlyZip(entries))).toBeNull();
  });
});

function parser() {
  return vi.fn(() => {
    throw new Error("parser must not run");
  });
}

describe.each([
  ["docx", (guard: boolean, spy: unknown) => new DocxAdapter({ engine: { parseDocx: spy } as never, ...(guard ? { zipGuard: "proportional" as const } : {}) })],
  ["pptx", (guard: boolean, spy: unknown) => new PptxAdapter({ engine: { openPptx: spy } as never, ops: {} as never, ...(guard ? { zipGuard: "proportional" as const } : {}) })],
  ["xlsx", (guard: boolean, spy: unknown) => new XlsxAdapter({ engine: { inventory: spy, readWorkbook: spy } as never, ...(guard ? { zipGuard: "proportional" as const } : {}) })],
] as const)("%s adapter zip guard", (format, make) => {
  it.each(Object.entries(bombs))("refuses %s before the parser runs when the host asks for the guard", async (_name, bytes) => {
    const spy = parser();
    const outcome = await make(true, spy).open({ bytes, format, document_id: "D1" });
    expect(outcome).toMatchObject({ outcome: "failed", failure_class: "corrupted" });
    expect(String((outcome as { message?: string }).message)).toContain("zip_bomb");
    expect(spy).not.toHaveBeenCalled();
  });

  it("hands a normal package to the parser", async () => {
    const spy = vi.fn(() => Promise.reject(new Error("stop here")));
    await make(true, spy).open({ bytes: normal, format, document_id: "D1" });
    expect(spy).toHaveBeenCalled();
  });

  it("does not pre-scan by default (web and server unchanged)", async () => {
    const spy = vi.fn(() => Promise.reject(new Error("stop here")));
    const outcome = await make(false, spy).open({ bytes: Object.values(bombs)[0] as Uint8Array, format, document_id: "D1" });
    expect(spy).toHaveBeenCalled();
    expect(String((outcome as { message?: string }).message)).not.toContain("zip_bomb");
  });
});
