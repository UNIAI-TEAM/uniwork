/**
 * Pure reading of a minutes page (a UniNote document, TipTap JSON) for the
 * Biên bản tab's preview. The server writes the page in a known shape
 * (`server/internal/service/meeting_minutes_render.go`): a "Label: value"
 * list, then `##` sections, `###` topics "(lúc 09:01)", decisions "(lúc 09:06,
 * 09:07)", tables and a closing "Người lập: …" line. People may edit the page,
 * so everything here degrades to plain blocks instead of throwing.
 */

export type DocNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: DocNode[];
};

/** The node, if the value is shaped like one (content is `unknown` on the wire). */
export function asNode(value: unknown): DocNode | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== "string") return null;
  return {
    type: v.type,
    text: typeof v.text === "string" ? v.text : undefined,
    attrs: v.attrs && typeof v.attrs === "object" ? (v.attrs as Record<string, unknown>) : undefined,
    marks: Array.isArray(v.marks)
      ? v.marks.flatMap((m) => {
          const mark = m as { type?: unknown; attrs?: unknown };
          return typeof mark?.type === "string"
            ? [{ type: mark.type, attrs: mark.attrs as Record<string, unknown> | undefined }]
            : [];
        })
      : undefined,
    content: Array.isArray(v.content) ? v.content.flatMap((c) => asNode(c) ?? []) : undefined,
  };
}

export function children(node: DocNode | null | undefined): DocNode[] {
  return node?.content ?? [];
}

/** All the text under a node, a hard break as a space. */
export function nodeText(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";
  if (node.type === "mention") return String(node.attrs?.label ?? "");
  return children(node).map(nodeText).join("");
}

const TIMES = /\s*\((?:lúc|at)\s+(\d{1,2}:\d{2}(?:\s*,\s*\d{1,2}:\d{2})*)\)\s*$/u;

/** "Khóa tính năng … (lúc 09:06, 09:07)" → the text and ["09:06", "09:07"]. */
export function splitTimes(text: string): { text: string; times: string[] } {
  const m = TIMES.exec(text);
  if (!m) return { text, times: [] };
  return { text: text.slice(0, m.index), times: m[1]!.split(",").map((s) => s.trim()) };
}

/** Text compared across the summary and the page: spaces collapsed, ends trimmed. */
export function sameText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const PROP = /^([^:]{1,24}):\s+(.+)$/su;

/** The page's opening "Thời gian: …" / "Chủ trì: …" list as label → value pairs; null when it is not one. */
export function docProps(node: DocNode | undefined): { label: string; value: string }[] | null {
  if (!node || node.type !== "bulletList") return null;
  const pairs = children(node).map((item) => PROP.exec(nodeText(item).trim()));
  if (pairs.length === 0 || pairs.some((m) => !m)) return null;
  return pairs.map((m) => ({ label: m![1]!.trim(), value: m![2]!.trim() }));
}

/** The section the AI writes (summary + topics), in the page's two layouts: muted ink until finalized. */
const AI_SECTIONS = new Set(["Nội dung", "Discussion"]);

export function isAiSection(heading: string): boolean {
  return AI_SECTIONS.has(sameText(heading));
}

export type DocSection = { heading: DocNode | null; blocks: DocNode[] };

/**
 * The page cut into its parts: the opening properties list, the sections
 * under each level-1/2 heading (blocks before the first heading form a
 * heading-less section) and the closing line, when the last block is a
 * paragraph that follows sections.
 */
export function docLayout(content: unknown): {
  props: { label: string; value: string }[] | null;
  sections: DocSection[];
  foot: DocNode | null;
} {
  const nodes = children(asNode(content));
  const props = docProps(nodes[0]);
  const rest = props ? nodes.slice(1) : nodes.slice();
  const hasHeadings = rest.some(isSectionHeading);
  const last = rest[rest.length - 1];
  const foot = hasHeadings && last?.type === "paragraph" && !isSectionHeading(rest[rest.length - 2]) ? rest.pop()! : null;
  const sections: DocSection[] = [];
  for (const node of rest) {
    if (isSectionHeading(node)) sections.push({ heading: node, blocks: [] });
    else if (sections.length === 0) sections.push({ heading: null, blocks: [node] });
    else sections[sections.length - 1]!.blocks.push(node);
  }
  return { props, sections, foot };
}

function isSectionHeading(node: DocNode | undefined): boolean {
  return node?.type === "heading" && Number(node.attrs?.level ?? 1) <= 2;
}
