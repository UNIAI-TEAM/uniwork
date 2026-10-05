/** @vitest-environment node */
// F-04 (UNI-927 visual-END): an inserted shape / text box must paint. Drives the
// REAL generated artifact (open -> add_element through the real PptxAdapter ->
// buildRenderSlide) and the views SVG emitter, so the assertion is on the node the
// canvas actually mounts, not on a hand-built render tree.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as artifact from "@uniwork/office-upstream/pptx-renderer";
import { bindPptxEngine, bindPptxOps, createPptxAdapter, type OpenedPptxLike } from "@uniwork/office-engine/pptx";
import { buildSlideSvg } from "../canvas/build-slide-svg";
import type { PptxRenderSlide } from "../canvas/render-tree";
import type { SvgNode } from "../canvas/svg-node";
import { addElementEdit, defaultInsertBox, insertShapeEdit, insertTextBoxEdit } from "./insert-model";

const FIXTURE = fileURLToPath(new URL("../../../../../docs/office/g0/fixtures/files/slides/pptx-standard-business.pptx", import.meta.url));
const palette = { pageFill: "#ffffff", chipFill: "#f4f4f5", chipStroke: "#e4e4e7", chipText: "#646464" };

async function renderAfter(edit: Parameters<ReturnType<typeof createPptxAdapter>["edit"]>[1]) {
  const adapter = createPptxAdapter({
    engine: bindPptxEngine(artifact as never),
    ops: bindPptxOps(artifact as never),
  });
  const opened = await adapter.open({ bytes: new Uint8Array(readFileSync(FIXTURE)), format: "pptx", document_id: "f04" });
  if (opened.outcome !== "opened") throw new Error("fixture did not open");
  const ref = opened.document_model_ref;
  const result = adapter.edit(ref, edit);
  const deck = (adapter.sessionOf(ref).model.opened as OpenedPptxLike).deck as { slides: unknown[]; size: { cx: number; cy: number } };
  const slide = artifact.buildRenderSlide(deck.slides[0] as never, deck.size as never, { fitWidthPx: 960, slideNo: 1 }) as unknown as PptxRenderSlide;
  const doc = buildSlideSvg(slide, {
    idPrefix: "f04",
    palette,
    presetPath: (preset, w, h, adjust) => artifact.presetPath(preset as never, w, h, adjust as never) as { d: string } | null,
  });
  return { createdId: result.createdId, root: doc.root };
}

function findGroup(node: SvgNode | string, id: string): SvgNode | null {
  if (typeof node === "string") return null;
  if (node.attrs?.["data-pptx-element-id"] === id) return node;
  for (const child of node.children ?? []) {
    const hit = findGroup(child, id);
    if (hit) return hit;
  }
  return null;
}

function paintedLeaves(node: SvgNode | string, out: SvgNode[] = []): SvgNode[] {
  if (typeof node === "string") return out;
  const fill = node.attrs?.fill;
  const stroke = node.attrs?.stroke;
  const painted = (typeof fill === "string" && fill !== "none") || (typeof stroke === "string" && stroke !== "none");
  if (painted && (node.tag === "path" || node.tag === "rect" || node.tag === "polygon" || node.tag === "ellipse")) out.push(node);
  for (const child of node.children ?? []) paintedLeaves(child, out);
  return out;
}

describe("inserted elements render (F-04)", () => {
  it("an inserted rectangle paints its preset geometry with the accent fill", async () => {
    const { createdId, root } = await renderAfter(insertShapeEdit(0, "rect"));
    expect(createdId).toBeTruthy();
    const group = findGroup(root, createdId!);
    expect(group?.attrs?.["data-pptx-node-type"]).toBe("shape");
    const leaves = paintedLeaves(group!);
    expect(leaves.length).toBeGreaterThan(0);
    expect(JSON.stringify(leaves).toLowerCase()).toContain("4472c4");
  });

  it("an inserted star paints its preset outline, not an empty geometry group", async () => {
    const { createdId, root } = await renderAfter(insertShapeEdit(0, "star5"));
    const leaves = paintedLeaves(findGroup(root, createdId!)!);
    const geometry = leaves.find((leaf) => leaf.tag === "polygon" || leaf.tag === "path");
    expect(geometry?.attrs?.fill).toBe("#4472C4");
    expect(String(geometry?.attrs?.points ?? geometry?.attrs?.d ?? "").split(" ").length).toBeGreaterThan(10);
  });

  it("reproduces the finding: the old unstyled edit leaves nothing painted", async () => {
    const { createdId, root } = await renderAfter(addElementEdit(0, "rect", defaultInsertBox("rect")));
    expect(paintedLeaves(findGroup(root, createdId!)!)).toEqual([]);
  });

  it("an inserted text box shows its placeholder text", async () => {
    const { createdId, root } = await renderAfter(insertTextBoxEdit(0, "Nhập văn bản"));
    const words = JSON.stringify(findGroup(root, createdId!)).match(/"text":"[^"]+"/g) ?? [];
    expect(words.map((word) => word.slice(8, -1)).join("")).toBe("Nhập văn bản");
  });
});
