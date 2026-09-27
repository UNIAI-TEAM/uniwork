// G2-03b binding surface — the vendor.ts mapping functions are exercised
// here over stub upstream modules (the real bundles are proven by
// test/replay/g2-03-replay.mjs against the vendored build artifacts).
import { describe, expect, it } from "vitest";
import { bindDocxCrypto, bindDocxEngine, DOCX_PACKAGE_PARTS_KEY } from "../src/docx/vendor";
import { bindPptxEngine, bindPptxOps, bindPptxRender } from "../src/pptx/vendor";

describe("bindDocxEngine", () => {
  it("forwards parseDocx/saveDocx and stashes enumerated parts under internal", async () => {
    const parsed = { blocks: [{ type: "paragraph", docxIndex: 0, runs: [{ text: "hi" }] }], internal: {} };
    const calls: unknown[] = [];
    const bound = bindDocxEngine(
      {
        async parseDocx(bytes, options) {
          calls.push(bytes, options);
          return parsed;
        },
        async saveDocx(p, blocks, options) {
          calls.push(p, blocks, options);
          return new Uint8Array([1, 2, 3]);
        },
      },
      { enumerateParts: async () => ["word/document.xml", "word/media/x.png"] },
    );
    const out = await bound.parseDocx(new Uint8Array([80, 75]));
    expect(out.internal?.[DOCX_PACKAGE_PARTS_KEY]).toEqual(["word/document.xml", "word/media/x.png"]);
    expect(bound.listPackageParts(out)).toEqual(["word/document.xml", "word/media/x.png"]);
    const saved = await bound.saveDocx(out, [{ kind: "original", docxIndex: 0 }], { savedAt: "x" });
    expect([...saved]).toEqual([1, 2, 3]);
    expect(calls.length).toBe(5);
  });

  it("leaves listPackageParts empty when no enumerator is supplied", async () => {
    const bound = bindDocxEngine({
      async parseDocx() {
        return { blocks: [] };
      },
      async saveDocx() {
        return new Uint8Array();
      },
    });
    expect(bound.listPackageParts({ blocks: [] })).toEqual([]);
  });
});

describe("bindDocxCrypto", () => {
  const cryptoLib = (behaviour: "ok" | "wrong" | "exotic") => ({
    async decrypt(_bytes: Uint8Array, _opts: { password: string }) {
      if (behaviour === "wrong") throw new Error("The password is incorrect");
      if (behaviour === "exotic") throw new Error("extensible encryption is not supported");
      return new Uint8Array([9, 9]);
    },
    encrypt(_bytes: Uint8Array, _opts: { password: string }) {
      return new Uint8Array([7, 7]);
    },
  });

  it("maps verifier mismatches to wrong-password and exotic schemes to unsupported", async () => {
    const crypto = bindDocxCrypto(cryptoLib("wrong"));
    await expect(crypto.decrypt(new Uint8Array(), "x")).rejects.toMatchObject({ reason: "wrong-password" });
    const exotic = bindDocxCrypto(cryptoLib("exotic"));
    await expect(exotic.decrypt(new Uint8Array(), "x")).rejects.toMatchObject({ reason: "unsupported" });
  });

  it("round-trips bytes through encrypt/decrypt without leaking the password", async () => {
    const crypto = bindDocxCrypto(cryptoLib("ok"));
    expect([...(await crypto.decrypt(new Uint8Array([1]), "pw"))]).toEqual([9, 9]);
    expect([...(await crypto.encrypt!(new Uint8Array([2]), "pw"))]).toEqual([7, 7]);
  });
});

describe("bindPptx* ", () => {
  const opened = {
    deck: { size: { cx: 12192000, cy: 6858000 }, slides: [{ id: "s1", elements: [] }] },
    archive: { entries: new Map() },
  };

  it("wires engine functions including optional commit/reparse/layout helpers", async () => {
    const bound = bindPptxEngine({
      openPptx: async () => opened,
      savePptx: async () => new Uint8Array([5]),
      commitSaved: () => undefined,
      reparseDeck: (o) => o,
      listSlideLayouts: () => [{ name: "Blank", path: "ppt/slideLayouts/slideLayout1.xml" }],
    });
    expect(await bound.openPptx(new Uint8Array([80, 75]))).toBe(opened);
    expect([...(await bound.savePptx(opened))]).toEqual([5]);
    expect(bound.listSlideLayouts?.({})).toEqual([{ name: "Blank", path: "ppt/slideLayouts/slideLayout1.xml" }]);
    expect(bound.reparseDeck?.(opened)).toBe(opened);
  });

  it("forwards runTxn and builds render slides through the render bundle", async () => {
    const ops = bindPptxOps({ runTxn: (_o, req) => ({ applied: req.ops.length > 0, records: [] }) });
    const result = ops.runTxn(opened, { ops: [{ op: "setHidden", args: { slide: 0, hidden: true } }], dryRun: false });
    expect(result.applied).toBe(true);

    const render = bindPptxRender({
      HeuristicMetrics: class {},
      buildRenderSlide: (slide, size, opts) => ({ slide: slide as object, size, fit: opts.fitWidthPx }),
    });
    const slide = await render.buildRenderSlide(opened, 0, 960);
    expect(slide.fit).toBe(960);
    await expect(render.buildRenderSlide(opened, 9, 960)).rejects.toThrow(/no slide/);
  });
});
