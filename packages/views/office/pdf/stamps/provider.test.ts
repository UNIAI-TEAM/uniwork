import { describe, expect, it, vi } from "vitest";
import { buildStampOperation, createPdfStampOperationProvider, PdfStampProviderError } from "./provider";
import type { PdfStampInput } from "./types";

const base: PdfStampInput = {
  kind: "image",
  contentType: "image/png",
  image: "AA==",
  placement: { pageIndex: 0, rect: [1, 2, 30, 40] },
};

describe("buildStampOperation", () => {
  it("builds a typed addStamp envelope with the resolved placement", () => {
    expect(buildStampOperation(base)).toEqual({
      op: "addStamp",
      attributes: { stamp: { kind: "image", pageIndex: 0, rect: [1, 2, 30, 40], contentType: "image/png", image: "AA==" } },
    });
  });

  it("resolves a displayed page through pageOrder", () => {
    const op = buildStampOperation({ ...base, placement: { pageIndex: 0, rect: [1, 2, 30, 40] } }, { pageOrder: [4, 1] });
    expect(op.attributes.stamp.pageIndex).toBe(4);
  });

  it("carries the signature id and rotation for a signature stamp", () => {
    const op = buildStampOperation({ ...base, kind: "signature", signatureId: "s1", placement: { pageIndex: 1, rect: [1, 2, 30, 40], quarterTurns: 90 } });
    expect(op.attributes.stamp).toMatchObject({ kind: "signature", signatureId: "s1", pageIndex: 1, quarterTurns: 90 });
  });

  it("refuses malformed input before any submitter sees it", () => {
    expect(() => buildStampOperation({ ...base, placement: { pageIndex: -1, rect: [1, 2, 30, 40] } })).toThrow(PdfStampProviderError);
    expect(() => buildStampOperation({ ...base, placement: { pageIndex: 0, rect: [1, 2, 1, 40] } })).toThrow(/positive dimensions/);
    expect(() => buildStampOperation({ ...base, image: "" })).toThrow(/image bytes/);
    expect(() => buildStampOperation({ ...base, contentType: "" })).toThrow(/contentType/);
    expect(() => buildStampOperation({ ...base, kind: "signature" })).toThrow(/signature id/);
    expect(() => buildStampOperation({ ...base, placement: { pageIndex: 0, rect: [1, 2, 30, 40], quarterTurns: 45 as 90 } })).toThrow(/quarterTurns/);
  });

  it("refuses a page outside the current order", () => {
    expect(() => buildStampOperation({ ...base, placement: { pageIndex: 5, rect: [1, 2, 30, 40] } }, { pageOrder: [0, 1] })).toThrow(/page order/);
  });
});

describe("createPdfStampOperationProvider", () => {
  it("submits one typed envelope", async () => {
    const submit = vi.fn();
    const provider = createPdfStampOperationProvider({}, { submit });
    await provider.placeStamp(base);
    expect(submit).toHaveBeenCalledWith([
      { op: "addStamp", attributes: { stamp: { kind: "image", pageIndex: 0, rect: [1, 2, 30, 40], contentType: "image/png", image: "AA==" } } },
    ]);
  });

  it("propagates a submitter that cannot place stamps yet", async () => {
    const submit = vi.fn(() => { throw Object.assign(new Error("not implemented"), { code: "unsupported_operation" }); });
    const provider = createPdfStampOperationProvider({}, { submit });
    await expect(provider.placeStamp(base)).rejects.toMatchObject({ code: "unsupported_operation" });
  });
});
