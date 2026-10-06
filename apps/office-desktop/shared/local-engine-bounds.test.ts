import { DocxAdapter } from "@uniwork/office-engine/docx";
import { describe, expect, it, vi } from "vitest";
import { LOCAL_ENGINE_BOUNDS } from "./local-engine-bounds";

describe("LOCAL_ENGINE_BOUNDS", () => {
  it("lifts the byte caps and asks for the proportional zip guard", () => {
    expect(LOCAL_ENGINE_BOUNDS).toEqual({
      maxInputBytes: Number.POSITIVE_INFINITY,
      maxOutputBytes: Number.POSITIVE_INFINITY,
      zipGuard: "proportional",
    });
  });

  it("makes an adapter refuse a zip bomb before parsing it", async () => {
    // One entry declaring 400 MiB inflated from 500 bytes, header only.
    const name = new TextEncoder().encode("a");
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, 500, true);
    cv.setUint32(24, 400 << 20, true);
    cv.setUint16(28, name.length, true);
    cen.set(name, 46);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(16, 4, true);
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, ...cen, ...end]);
    const parseDocx = vi.fn();
    const adapter = new DocxAdapter({ engine: { parseDocx } as never, ...LOCAL_ENGINE_BOUNDS });
    const outcome = await adapter.open({ bytes, format: "docx", document_id: "D1" });
    expect(outcome).toMatchObject({ outcome: "failed", failure_class: "corrupted" });
    expect(parseDocx).not.toHaveBeenCalled();
  });
});
