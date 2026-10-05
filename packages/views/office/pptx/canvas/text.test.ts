/** @vitest-environment node */
// F-07 / F-20 (UNI-927 visual-END): the engine lays runs out with HeuristicMetrics, so a
// run's `x` / `widthPx` are authoritative; the browser's face must be constrained to them.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as artifact from "@uniwork/office-upstream/pptx-renderer";
import { bindPptxEngine, bindPptxOps, createPptxAdapter, type OpenedPptxLike } from "@uniwork/office-engine/pptx";
import { buildSlideSvg } from "./build-slide-svg";
import { box, byTag, run, shapeNode, slide, textLayout } from "./pptx-render-fixtures";
import type { PptxRenderSlide } from "./render-tree";

const palette = { pageFill: "#ffffff", chipFill: "#f4f4f5", chipStroke: "#e4e4e7", chipText: "#646464" };
const FIXTURE = fileURLToPath(new URL("../../../../../docs/office/g0/fixtures/files/slides/pptx-standard-business.pptx", import.meta.url));

function textsFor(runs: Parameters<typeof run>[0][]) {
  const doc = buildSlideSvg(slide([shapeNode({ box: box({ w: 400, h: 80 }), text: textLayout({ lines: [{ runs: runs.map((r) => run(r)), top: 0, height: 30 }] }) })]), { idPrefix: "t", palette });
  return byTag(doc.root, "text");
}

describe("run font stack", () => {
  it("maps Office faces to metric-compatible substitutes before the generic", () => {
    const stacks = textsFor([{ fontFamily: "Calibri" }, { fontFamily: "Cambria" }, { fontFamily: "Arial" }, { fontFamily: "Times New Roman" }, { fontFamily: "Georgia" }, { fontFamily: "Verdana" }]).map((t) => String(t.attrs?.["font-family"]));
    expect(stacks[0]).toBe("'Calibri', 'Carlito', sans-serif");
    expect(stacks[1]).toBe("'Cambria', 'Caladea', serif");
    expect(stacks[2]).toBe("'Arial', 'Liberation Sans', 'Arimo', sans-serif");
    expect(stacks[3]).toBe("'Times New Roman', 'Liberation Serif', 'Tinos', serif");
    expect(stacks[4]).toBe("'Georgia', 'Gelasio', serif");
    expect(stacks[5]).toBe("'Verdana', 'DejaVu Sans', sans-serif");
  });

  it("does not treat a sans-serif family name as serif", () => {
    const [text] = textsFor([{ fontFamily: "Microsoft Sans Serif" }]);
    expect(text?.attrs?.["font-family"]).toBe("'Microsoft Sans Serif', sans-serif");
  });
});

describe("run width contract", () => {
  it("pins every run to the engine's measured width", () => {
    const [text] = textsFor([{ text: "Business ", widthPx: 91.5 }]);
    expect(text?.attrs).toMatchObject({ textLength: 91.5, lengthAdjust: "spacing" });
  });

  it("leaves single glyphs and zero-width runs unconstrained", () => {
    const texts = textsFor([{ text: "A", widthPx: 12 }, { text: "ab", widthPx: 0 }]);
    expect(texts[0]?.attrs?.textLength).toBeUndefined();
    expect(texts[1]?.attrs?.textLength).toBeUndefined();
  });

  it("real deck: runs advance monotonically and every multi-glyph run is width-pinned", async () => {
    const adapter = createPptxAdapter({ engine: bindPptxEngine(artifact as never), ops: bindPptxOps(artifact as never) });
    const opened = await adapter.open({ bytes: new Uint8Array(readFileSync(FIXTURE)), format: "pptx", document_id: "f07" });
    if (opened.outcome !== "opened") throw new Error("fixture did not open");
    const deck = (adapter.sessionOf(opened.document_model_ref).model.opened as OpenedPptxLike).deck as { slides: unknown[]; size: { cx: number; cy: number } };
    const render = artifact.buildRenderSlide(deck.slides[0] as never, deck.size as never, { fitWidthPx: 960, slideNo: 1 }) as unknown as PptxRenderSlide;
    let checked = 0;
    for (const node of render.nodes) {
      for (const line of (node.type === "shape" || node.type === "text" ? node.text?.lines : undefined) ?? []) {
        for (let i = 1; i < line.runs.length; i += 1) {
          const prev = line.runs[i - 1]!;
          expect(line.runs[i]!.x).toBeCloseTo(prev.x + prev.widthPx, 3);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    const doc = buildSlideSvg(render, { idPrefix: "f07", palette });
    for (const text of byTag(doc.root, "text")) {
      const glyphs = [...(text.text ?? "")].length;
      if (glyphs > 1) expect(Number(text.attrs?.textLength)).toBeGreaterThan(0);
    }
  });
});
