"use client";

// UNI-924 A6: heading outline extraction for the navigation pane.
//
// Mirrors genoffice's collectHeadings (editor/headings.ts): the outline is the
// top-level `docHeading` blocks in document order. Nesting is derived from the
// heading levels with the usual outline stack (a heading nests under the
// nearest previous heading of a lower level), so a level skip (H1 -> H3) still
// nests instead of dropping the deeper heading.

/** The structural slice of a ProseMirror node this module reads; TipTap's
 *  `editor.state.doc` satisfies it. */
export interface DocxOutlineDocNode {
  readonly type: { readonly name: string };
  readonly textContent: string;
  readonly attrs?: Readonly<Record<string, unknown>> | undefined;
  forEach(callback: (node: DocxOutlineDocNode, offset: number) => void): void;
}

export interface DocxOutlineItem {
  /** Stable id for React keys / active tracking within one extraction — an
   *  edit that shifts the heading's position produces a new id. */
  id: string;
  level: number;
  text: string;
  /** Top-level ProseMirror position of the heading (`view.nodeDOM(pos)`). */
  pos: number;
  children: DocxOutlineItem[];
}

const DOCX_OUTLINE_MAX_LEVEL = 9;

function outlineLevel(node: DocxOutlineDocNode): number {
  const raw = Number(node.attrs?.level ?? 1);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(DOCX_OUTLINE_MAX_LEVEL, Math.max(1, Math.round(raw)));
}

/** The heading outline of a ProseMirror-shaped document, nested by level. */
export function docxOutlineFromDoc(doc: DocxOutlineDocNode | null | undefined): DocxOutlineItem[] {
  if (!doc) return [];
  const flat: DocxOutlineItem[] = [];
  doc.forEach((node, offset) => {
    if (node.type?.name !== "docHeading") return;
    const text = node.textContent.trim();
    if (!text) return;
    flat.push({ id: `heading-${offset}`, level: outlineLevel(node), text, pos: offset, children: [] });
  });
  return nestDocxOutline(flat);
}

function nestDocxOutline(flat: DocxOutlineItem[]): DocxOutlineItem[] {
  const roots: DocxOutlineItem[] = [];
  const stack: DocxOutlineItem[] = [];
  for (const item of flat) {
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= item.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(item);
    else roots.push(item);
    stack.push(item);
  }
  return roots;
}
