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

export interface DocxDomOutline {
  items: DocxOutlineItem[];
  /** The heading element each top-level item was extracted from, so a click
   *  can scroll it without a ProseMirror view. */
  elementById: Map<string, HTMLElement>;
}

function headingLevelFromTag(tagName: string): number | null {
  const match = /^H([1-6])$/.exec(tagName);
  if (!match) return null;
  const level = Number(match[1]);
  if (!Number.isFinite(level)) return null;
  return Math.min(DOCX_OUTLINE_MAX_LEVEL, Math.max(1, level));
}

/**
 * The outline of the rendered document: the top-level `h1`-`h6` blocks (the
 * elements the vendored `docHeading` node renders) in document order, nested by
 * tag level. DOM-side counterpart of docxOutlineFromDoc for the wiring, which
 * cannot reach the TipTap editor; `pos` carries the child index and clicks go
 * through `elementById`.
 */
export function docxOutlineFromElement(root: Element | null | undefined): DocxDomOutline {
  const elementById = new Map<string, HTMLElement>();
  if (!root) return { items: [], elementById };
  const flat: DocxOutlineItem[] = [];
  Array.from(root.children).forEach((child, index) => {
    const level = headingLevelFromTag(child.tagName);
    if (level === null) return;
    const text = child.textContent?.trim() ?? "";
    if (!text) return;
    const id = `dom-heading-${index}`;
    flat.push({ id, level, text, pos: index, children: [] });
    elementById.set(id, child as HTMLElement);
  });
  return { items: nestDocxOutline(flat), elementById };
}
