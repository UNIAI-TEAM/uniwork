import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { DocxBlock, DocxGeneratedBlock, DocxRun } from "@uniwork/office-engine/docx";
import { blocksToPmDoc, inlineToRuns as rendererInlineToRuns, pmNodeToGeneratedBlock } from "@uniwork/office-upstream/docs-renderer-editor";
import type { DocxBlockKind, DocxBlockList } from "./docx-schema";

export function inlineToRuns(node: PMNode): DocxRun[] {
  return rendererInlineToRuns(node.toJSON().content ?? []);
}

export function runsHaveText(runs: DocxRun[]): boolean {
  return runs.some((run) => run.text.length > 0);
}

export function runsEqual(left: DocxRun[], right: DocxRun[]): boolean {
  const normalize = (runs: DocxRun[]) => runs.map((run) => Object.fromEntries(
    Object.entries(run).filter(([, value]) => value !== undefined && value !== false).sort(([first], [second]) => first.localeCompare(second)),
  ));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function listsEqual(left: DocxBlockList | null, right: DocxBlockList | null): boolean {
  if (left === null || right === null) return left === right;
  return left.kind === right.kind && left.numId === right.numId && left.ilvl === right.ilvl;
}

export function kindOf(block: DocxBlock): { blockKind: DocxBlockKind; level: number | null; list: DocxBlockList | null } {
  if (block.type === "heading") return { blockKind: "heading", level: typeof block.level === "number" ? block.level : 1, list: null };
  if (block.type === "listItem") return { blockKind: "listItem", level: null, list: (block.list as DocxBlockList | undefined) ?? { kind: "bullet", numId: "0", ilvl: 0 } };
  return { blockKind: block.type === "paragraph" ? "paragraph" : "other", level: null, list: null };
}

export function blocksToDoc(blocks: DocxBlock[], sections?: unknown[], options?: { legacyTableIndent?: boolean }): JSONContent {
  return blocksToPmDoc(blocks.filter((block) => !block.hidden && block.docxIndex !== null), sections, options);
}

export type DesiredItem =
  | { kind: "passthrough"; docxIndex: number }
  | { kind: "text-edit"; docxIndex: number; runs: DocxRun[] }
  | { kind: "restyle"; docxIndex: number; block: DocxGeneratedBlock }
  | { kind: "insert"; block: DocxGeneratedBlock };

export function computeDesiredList(doc: PMNode, blocksByIndex: Map<number, DocxBlock>): DesiredItem[] {
  const desired: DesiredItem[] = [];
  doc.forEach((node) => {
    const docxIndex: number | null = node.attrs.docxIndex ?? null;
    const original = docxIndex === null ? undefined : blocksByIndex.get(docxIndex);
    const blockKind = node.type.name === "docParagraph" ? "paragraph" : node.type.name === "docHeading" ? "heading" : node.type.name === "docListItem" ? "listItem" : "other";
    if (blockKind === "other") {
      if (docxIndex !== null) desired.push({ kind: "passthrough", docxIndex });
      return;
    }
    const runs = inlineToRuns(node);
    if (!runsHaveText(runs)) return;
    const generated = pmNodeToGeneratedBlock(node.toJSON());
    if (!original || docxIndex === null) {
      desired.push({ kind: "insert", block: generated });
      return;
    }
    const baselineJson = blocksToDoc([original]).content?.[0];
    const baseline = baselineJson ? doc.type.schema.nodeFromJSON(baselineJson) : null;
    if (baseline?.eq(node)) {
      desired.push({ kind: "passthrough", docxIndex });
      return;
    }
    const originalKind = kindOf(original);
    const currentList = blockKind === "listItem" ? { kind: node.attrs.kind, numId: node.attrs.numId, ilvl: node.attrs.ilvl } : null;
    const sameKind = originalKind.blockKind === blockKind
      && originalKind.level === (blockKind === "heading" ? node.attrs.level : null)
      && listsEqual(originalKind.list, currentList);
    if (sameKind && runsEqual(runs, baseline ? inlineToRuns(baseline) : original.runs ?? [])) {
      desired.push({ kind: "passthrough", docxIndex });
    } else if (sameKind && blockKind === "paragraph") {
      desired.push({ kind: "text-edit", docxIndex, runs });
    } else {
      desired.push({ kind: "restyle", docxIndex, block: generated });
    }
  });
  return desired;
}
