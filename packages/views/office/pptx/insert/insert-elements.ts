/**
 * The top-level elements of the current slide as the Insert panel's connector
 * and group pickers see them (UNI-927 R4fix-connector).
 *
 * Read from the slide rendition, which the editor rebuilds on every deck
 * revision, so an insert, delete, rename or slide switch refreshes the list.
 * Layout/master decoration is not a slide element and is left out. The label is
 * a human name (a picture's name, else the first line of the shape's text);
 * a shape with neither stays unlabeled and the picker numbers it, never its id.
 */
import type { PptxRenderNode, PptxRenderSlide } from "../canvas/render-tree";
import { textFromLayout } from "../text/text-model";
import type { PptxInsertElementRef } from "./insert-model";

const MAX_LABEL_CHARS = 32;

function labelOf(node: PptxRenderNode): string | undefined {
  const raw = node.type === "picture" ? node.name : node.type === "shape" || node.type === "text" ? (node.text ? textFromLayout(node.text) : "") : "";
  const line = raw?.split("\n").map((part) => part.trim()).find((part) => part.length > 0);
  if (!line) return undefined;
  return line.length > MAX_LABEL_CHARS ? `${line.slice(0, MAX_LABEL_CHARS - 1)}…` : line;
}

export function pptxInsertElements(rendition: PptxRenderSlide | null): readonly PptxInsertElementRef[] {
  if (!rendition) return [];
  return rendition.nodes
    .filter((node) => !node.decoration && !node.background)
    .map((node) => {
      const label = labelOf(node);
      // A connector is a `shape` node drawn as a line (p:cxnSp): the pane restyles it but never connects to it.
      const connector = node.type === "shape" && node.line !== undefined;
      return { id: node.sourceId, type: node.type, ...(label ? { label } : {}), ...(connector ? { connector: true } : {}) };
    });
}
