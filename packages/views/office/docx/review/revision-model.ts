// A12 (UNI-924): read-only view of the tracked-change model the vendored
// renderer already keeps in the editor document.
//
// The DOCX browser bundle (@uniwork/office-upstream/docs-renderer-editor)
// does not export the vendored revisions helpers
// (upstream/apps/docs/src/renderer/editor/revisions.ts), so the collect pass
// is ported here — same marks (ins/del/rprChange) and same node attrs
// (blockRevision / rowRevision / cellRevision / pPrChange / moveRevision) the
// parser fills, never a second diff model. Keep the semantics in step with the
// vendored module when it changes.
import type { Node as PmNode } from "@tiptap/pm/model";

export type DocxReviewChangeKind =
  | "ins"
  | "del"
  | "both"
  | "pPrChange"
  | "moveFrom"
  | "moveTo"
  | "rPrChange"
  | "rowIns"
  | "rowDel"
  | "cellIns"
  | "cellDel"
  | "blockIns"
  | "blockDel";

/** One revision range in document order. `from`/`to` are ProseMirror
 * positions; `id` is derived from them so a row stays addressable between the
 * render that listed it and the click that acts on it. */
export interface DocxReviewChange {
  id: string;
  kind: DocxReviewChangeKind;
  author: string;
  date?: string;
  from: number;
  to: number;
  /** Text excerpt the change covers (empty when the range holds no text). */
  snippet: string;
}

export const DOCX_REVIEW_KIND_LABEL_KEYS: Record<DocxReviewChangeKind, string> = {
  ins: "office.docx.review.kind.ins",
  del: "office.docx.review.kind.del",
  both: "office.docx.review.kind.both",
  pPrChange: "office.docx.review.kind.pPrChange",
  moveFrom: "office.docx.review.kind.moveFrom",
  moveTo: "office.docx.review.kind.moveTo",
  rPrChange: "office.docx.review.kind.rPrChange",
  rowIns: "office.docx.review.kind.rowIns",
  rowDel: "office.docx.review.kind.rowDel",
  cellIns: "office.docx.review.kind.cellIns",
  cellDel: "office.docx.review.kind.cellDel",
  blockIns: "office.docx.review.kind.blockIns",
  blockDel: "office.docx.review.kind.blockDel",
};

const SNIPPET_LIMIT = 160;

function snippetOf(doc: PmNode, from: number, to: number): string {
  const start = Math.max(0, Math.min(from, doc.content.size));
  const end = Math.max(start, Math.min(to, doc.content.size));
  const text = doc.textBetween(start, end, " ").replace(/\s+/g, " ").trim();
  return text.length > SNIPPET_LIMIT ? `${text.slice(0, SNIPPET_LIMIT - 1)}…` : text;
}

interface RevisionAttrs {
  kind?: "ins" | "del";
  author?: string;
  date?: string;
}

function attrsOf(value: unknown): RevisionAttrs | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind === "ins" || record.kind === "del" ? record.kind : undefined;
  return {
    ...(kind ? { kind } : {}),
    author: typeof record.author === "string" ? record.author : "",
    ...(typeof record.date === "string" ? { date: record.date } : {}),
  };
}

const PARAGRAPH_NODE_TYPES = new Set(["docParagraph", "docHeading", "docListItem"]);
const TABLE_NODE_TYPES = new Set(["docTableRow", "docTableCell", "docTableHeader"]);

type Range = Omit<DocxReviewChange, "id">;

/**
 * Every tracked change in `doc`, in document order. Adjacent same-kind ranges
 * of the same author merge into one entry (the vendored collectRevisions
 * behaviour); a row/cell revision suppresses the text marks inside it so a
 * deleted row reads as one change.
 */
export function collectReviewChanges(doc: PmNode): DocxReviewChange[] {
  const out: Range[] = [];

  const suppressed: Array<{ from: number; to: number; kind: "ins" | "del" }> = [];
  doc.forEach((node, pos) => {
    const revision = attrsOf(node.attrs?.blockRevision);
    if (!revision?.kind) return;
    out.push({
      from: pos,
      to: pos + node.nodeSize,
      kind: revision.kind === "ins" ? "blockIns" : "blockDel",
      author: revision.author ?? "",
      ...(revision.date ? { date: revision.date } : {}),
      snippet: snippetOf(doc, pos, pos + node.nodeSize),
    });
    suppressed.push({ from: pos, to: pos + node.nodeSize, kind: revision.kind });
  });

  const tableRevs: Range[] = [];
  doc.descendants((node, pos) => {
    if (!TABLE_NODE_TYPES.has(node.type.name)) return;
    const isRow = node.type.name === "docTableRow";
    const revision = attrsOf(isRow ? node.attrs?.rowRevision : node.attrs?.cellRevision);
    if (!revision?.kind) return;
    tableRevs.push({
      from: pos,
      to: pos + node.nodeSize,
      kind: isRow ? (revision.kind === "ins" ? "rowIns" : "rowDel") : revision.kind === "ins" ? "cellIns" : "cellDel",
      author: revision.author ?? "",
      ...(revision.date ? { date: revision.date } : {}),
      snippet: snippetOf(doc, pos, pos + node.nodeSize),
    });
    suppressed.push({ from: pos, to: pos + node.nodeSize, kind: revision.kind });
  });
  const isSuppressed = (pos: number, kind: "ins" | "del" | "both"): boolean =>
    suppressed.some((entry) => pos >= entry.from && pos < entry.to && (kind === "both" || entry.kind === kind));

  doc.descendants((node, pos) => {
    if (!PARAGRAPH_NODE_TYPES.has(node.type.name)) return;
    const pPrChange = node.attrs?.pPrChange as string | null | undefined;
    const moveRevision = node.attrs?.moveRevision as string | null | undefined;
    if (pPrChange) {
      let author = "";
      let date: string | undefined;
      try {
        const parsed = JSON.parse(pPrChange) as { author?: unknown; date?: unknown };
        if (typeof parsed?.author === "string") author = parsed.author;
        if (typeof parsed?.date === "string") date = parsed.date;
      } catch {
        /* malformed snapshot: keep the change, without an author */
      }
      out.push({
        from: pos,
        to: pos + node.nodeSize,
        kind: "pPrChange",
        author,
        ...(date ? { date } : {}),
        snippet: snippetOf(doc, pos, pos + node.nodeSize),
      });
    } else if (moveRevision === "from" || moveRevision === "to") {
      out.push({
        from: pos,
        to: pos + node.nodeSize,
        kind: moveRevision === "from" ? "moveFrom" : "moveTo",
        author: "",
        snippet: snippetOf(doc, pos, pos + node.nodeSize),
      });
    }
  });

  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const ins = node.marks.find((mark) => mark.type.name === "ins");
    const del = node.marks.find((mark) => mark.type.name === "del");
    if (!ins && !del) {
      const rpr = node.marks.find((mark) => mark.type.name === "rprChange");
      if (!rpr) return;
      const author = String(rpr.attrs.author ?? "");
      const previous = out[out.length - 1];
      if (previous && previous.to === pos && previous.kind === "rPrChange" && previous.author === author) {
        previous.to = pos + node.nodeSize;
        previous.snippet = snippetOf(doc, previous.from, previous.to);
      } else {
        out.push({
          from: pos,
          to: pos + node.nodeSize,
          kind: "rPrChange",
          author,
          ...(rpr.attrs.date ? { date: String(rpr.attrs.date) } : {}),
          snippet: snippetOf(doc, pos, pos + node.nodeSize),
        });
      }
      return;
    }
    const kind: "ins" | "del" | "both" = ins && del ? "both" : ins ? "ins" : "del";
    if (isSuppressed(pos, kind)) return;
    const source = (del ?? ins) as { attrs: Record<string, unknown> } | undefined;
    const author = String(source?.attrs.author ?? "");
    const sourceDate = source?.attrs.date ? String(source.attrs.date) : undefined;
    const previous = out[out.length - 1];
    if (previous && previous.to === pos && previous.kind === kind && previous.author === author) {
      previous.to = pos + node.nodeSize;
      previous.snippet = snippetOf(doc, previous.from, previous.to);
    } else {
      out.push({
        from: pos,
        to: pos + node.nodeSize,
        kind,
        author,
        ...(sourceDate ? { date: sourceDate } : {}),
        snippet: snippetOf(doc, pos, pos + node.nodeSize),
      });
    }
  });

  out.push(...tableRevs);
  out.sort((left, right) => left.from - right.from);

  const seen = new Map<string, number>();
  return out.map((change) => {
    const base = `${change.kind}:${change.from}:${change.to}`;
    const duplicates = seen.get(base) ?? 0;
    seen.set(base, duplicates + 1);
    return { ...change, id: duplicates === 0 ? base : `${base}#${duplicates}` };
  });
}

/** The change with `id` in the current collection, or null when the document
 * moved on and the id is stale. */
export function findReviewChange(changes: readonly DocxReviewChange[], id: string): DocxReviewChange | null {
  return changes.find((change) => change.id === id) ?? null;
}
