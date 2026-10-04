/**
 * Text-editing model helpers (task A1ui, UNI-927).
 *
 * The in-place editor turns a text element's rendered lines back into plain text, and a
 * user's typed text back into the engine's paragraph shape. Both directions are pure, so
 * the round-trip the demo depends on is unit-tested without a DOM.
 *
 * Fonts are deliberately not modelled here: a commit carries one run per paragraph with
 * only its `text`, so the engine keeps the element's existing run properties instead of
 * the editor inventing an override.
 */
import type { PptxParagraphLike } from "@uniwork/office-engine/pptx";
import type { PptxRenderNode, PptxRenderSlide, PptxTextLayout } from "../canvas/render-tree";
import type { PptxBox } from "../selection/geometry";

/** One text element the in-place editor can open, in absolute page coordinates. */
export interface PptxTextTarget {
  sourceId: string;
  box: PptxBox;
  /** Plain text, one paragraph per newline. */
  text: string;
  /** Page-px font size of the first run, so the overlay matches the slide. */
  fontSizePx?: number;
  align?: "left" | "center" | "right" | "justify";
}

/**
 * Plain text of a laid-out text block: soft-wrapped lines join without a separator and a
 * line whose `paraStart` is set begins a new paragraph. Bullet markers are paint-time
 * decorations, so they are skipped.
 */
export function textFromLayout(layout: PptxTextLayout): string {
  const chunks: string[] = [];
  for (const line of layout.lines) {
    const lineText = line.runs.filter((run) => !run.isBullet).map((run) => run.text).join("");
    chunks.push(line.paraStart && chunks.length > 0 ? "\n" + lineText : lineText);
  }
  return chunks.join("");
}

/** Typed text -> paragraphs, one plain run each; newlines separate paragraphs. */
export function paragraphsFromText(text: string): PptxParagraphLike[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => ({ runs: [{ text: line }] }));
}

/** Paragraphs -> plain text; the inverse of `paragraphsFromText`. */
export function textFromParagraphs(paragraphs: readonly PptxParagraphLike[]): string {
  return paragraphs.map((paragraph) => (paragraph.runs ?? []).map((run) => run.text ?? "").join("")).join("\n");
}

/** Refuse a commit whose text is empty or whitespace: null means "keep the original". */
export function guardCommitText(text: string): PptxParagraphLike[] | null {
  if (text.trim() === "") return null;
  return paragraphsFromText(text);
}

/** Every text-bearing element on the slide, flattened out of its groups (absolute page px). */
export function collectTextTargets(slide: PptxRenderSlide): PptxTextTarget[] {
  const out: PptxTextTarget[] = [];
  const visit = (nodes: readonly PptxRenderNode[], offsetX: number, offsetY: number): void => {
    for (const node of nodes) {
      const box = { x: node.box.x + offsetX, y: node.box.y + offsetY, w: node.box.w, h: node.box.h };
      if (node.type === "group") {
        visit(node.children, box.x, box.y);
        continue;
      }
      if (node.decoration || node.background) continue;
      if (node.type !== "shape" && node.type !== "text") continue;
      const layout = node.text;
      if (!layout || layout.lines.length === 0) continue;
      const first = layout.lines[0]!;
      const run = first.runs.find((candidate) => !candidate.isBullet);
      out.push({
        sourceId: node.sourceId,
        box,
        text: textFromLayout(layout),
        ...(run ? { fontSizePx: run.fontSizePx } : {}),
        ...(first.align ? { align: first.align } : {}),
      });
    }
  };
  visit(slide.nodes, 0, 0);
  return out;
}