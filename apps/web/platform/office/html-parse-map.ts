import { parse, type DefaultTreeAdapterTypes as T } from "parse5";
import type { UpstreamParseMap } from "@uniwork/office-engine/html";

/**
 * The browser parse map for the HTML visual editor: every element of the source
 * with its exact source ranges, so H3 document ops (packages/views/office/html/
 * visual/ops) can name an element by sid and compile an edit to source patches.
 *
 * Provenance: a port of genoffice `apps/html/src/renderer/document/parse-map.ts`
 * (pinned 09485f88, Apache-2.0, vendored under packages/office-upstream). The
 * vendored build only bundles the docs / xlsx / pptx renderers, so the web host
 * carries this one function itself over parse5 - the same parser upstream uses -
 * and keeps its behaviour: elements are those with a source location, deduped by
 * start-tag offset (the adoption agency re-creates formatting elements that
 * share one start tag), and a rebuild reuses the previous sid for an element
 * with the same tag, path and the closest start offset, so a selection survives
 * an edit elsewhere in the document.
 */

type ParseMapElement = UpstreamParseMap["elements"][number];

interface Found {
  node: T.Element;
  parent: T.Element | null;
  depth: number;
}

function isElement(node: T.Node): node is T.Element {
  return "tagName" in node && typeof (node as T.Element).tagName === "string";
}

function nthOfType(node: T.Element): number {
  const parent = node.parentNode;
  if (!parent || !("childNodes" in parent)) return 1;
  let n = 0;
  for (const sibling of parent.childNodes) {
    if (isElement(sibling) && sibling.tagName === node.tagName) {
      n += 1;
      if (sibling === node) return n;
    }
  }
  return n;
}

/** Elements with a source location, in document order, deduped by start-tag offset. */
function collect(root: T.Node): Found[] {
  const out: Found[] = [];
  const seen = new Set<number>();
  const walk = (node: T.Node, parent: T.Element | null, depth: number) => {
    let nextParent = parent;
    let nextDepth = depth;
    if (isElement(node)) {
      const start = node.sourceCodeLocation?.startTag;
      if (start && !seen.has(start.startOffset)) {
        seen.add(start.startOffset);
        out.push({ node, parent, depth });
        nextParent = node;
        nextDepth = depth + 1;
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) walk(child, nextParent, nextDepth);
    if (isElement(node) && node.tagName === "template") {
      const content = (node as T.Template).content;
      if (content) for (const child of content.childNodes) walk(child, node, nextDepth);
    }
  };
  walk(root, null, 0);
  return out;
}

/** The previous sid of the same tag + path whose start tag is closest, if any. */
function matchSid(entry: Omit<ParseMapElement, "sid">, previous: UpstreamParseMap | null, used: Set<number>): number | null {
  if (!previous) return null;
  let best: ParseMapElement | null = null;
  let bestDistance = Infinity;
  for (const old of previous.elements) {
    if (used.has(old.sid) || old.tag !== entry.tag || old.path !== entry.path) continue;
    const distance = Math.abs(old.startTag[0] - entry.startTag[0]);
    if (distance < bestDistance) {
      best = old;
      bestDistance = distance;
    }
  }
  if (!best) return null;
  used.add(best.sid);
  return best.sid;
}

export function buildHtmlParseMap(text: string, version: number, previous: UpstreamParseMap | null = null): UpstreamParseMap {
  let errorCount = 0;
  const doc = parse(text, {
    sourceCodeLocationInfo: true,
    onParseError: () => {
      errorCount += 1;
    },
  });
  let nextSid = previous ? Math.max(0, ...previous.elements.map((element) => element.sid)) + 1 : 1;
  const used = new Set<number>();
  const sidByNode = new Map<T.Element, number>();
  const pathByNode = new Map<T.Element, string>();
  const elements: ParseMapElement[] = [];

  for (const { node, parent, depth } of collect(doc)) {
    const location = node.sourceCodeLocation!;
    const startTag: [number, number] = [location.startTag!.startOffset, location.startTag!.endOffset];
    const endTag: [number, number] | null = location.endTag ? [location.endTag.startOffset, location.endTag.endOffset] : null;
    const rangeEnd = endTag ? endTag[1] : location.endOffset;
    const inner: [number, number] = [startTag[1], endTag ? endTag[0] : Math.max(startTag[1], location.endOffset)];
    const parentPath = parent ? pathByNode.get(parent) : undefined;
    const segment = node.tagName === "html" || node.tagName === "head" || node.tagName === "body" ? node.tagName : `${node.tagName}:nth-of-type(${nthOfType(node)})`;
    const path = parentPath ? `${parentPath} > ${segment}` : segment;
    pathByNode.set(node, path);
    const textNodes: Array<[number, number]> = [];
    for (const child of node.childNodes) {
      const childLocation = (child as T.TextNode).sourceCodeLocation;
      if ("value" in child && childLocation) textNodes.push([childLocation.startOffset, childLocation.endOffset]);
    }
    const partial: Omit<ParseMapElement, "sid"> = {
      textNodes,
      tag: node.tagName,
      parentSid: parent ? (sidByNode.get(parent) ?? null) : null,
      depth,
      range: [startTag[0], rangeEnd],
      startTag,
      endTag,
      inner,
      path,
    };
    const sid = matchSid(partial, previous, used) ?? nextSid++;
    sidByNode.set(node, sid);
    elements.push({ sid, ...partial });
  }

  return { version, elements, bySid: new Map(elements.map((element) => [element.sid, element])), errorCount };
}
