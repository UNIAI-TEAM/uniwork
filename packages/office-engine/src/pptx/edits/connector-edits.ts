// R4fix-connector-engine (UNI-927) - glued connector insert, bound one-to-one
// to the vendored pptx-ops `addConnector`.
//
// Vendored contract (READ ONLY - never imported; cited for every field):
//   addConnector  packages/pptx-ops/src/ops/arrange-ops.ts:286
//                 (validate: both endpoints resolve on the slide and carry a
//                 shape id, from !== to, kind in CONNECTOR_KINDS (:172), arrow
//                 none/end/both (:280); apply: picks the closest side pair,
//                 writes <p:cxnSp> with <a:stCxn>/<a:endCxn> glued to both
//                 shapes via setElementConnection)
//
// fromSide/toSide pin one end to a side (vendored sideOf, arrange-ops.ts: top/left/bottom/right);
// an omitted side keeps the closest-pair pick. `line` is the vendored connectorLine
// ({ color #RRGGBB, widthPt | widthEmu, dash prstDash }); omitted keeps the 1pt black default.
//
// The endpoints ride `elementIds: [start, end]` so the host journal's replay
// refs (replay-refs.ts ELEMENT_ID_KEYS) re-target both ends after a reopen.
// Geometry comes from the endpoint shapes, so nothing is px-converted.
import { PptxEngineError, type OpenedPptxLike, type PptxOp } from "../engine";

/** Connector routing kinds, copied from the vendored CONNECTOR_KINDS keys. */
export const PPTX_CONNECTOR_KINDS = ["straight", "elbow", "curved"] as const;
export type PptxConnectorKind = (typeof PPTX_CONNECTOR_KINDS)[number];

/** Arrowheads, copied from the vendored arrowOf contract. */
export const PPTX_CONNECTOR_ARROWS = ["none", "end", "both"] as const;
export type PptxConnectorArrow = (typeof PPTX_CONNECTOR_ARROWS)[number];

/** Attach sides, copied from the vendored SIDES. */
const CONNECTOR_SIDES = ["top", "left", "bottom", "right"] as const;
export type PptxConnectorSide = (typeof CONNECTOR_SIDES)[number];

/** Prst dash names the vendored connectorLine accepts (arrange-ops.ts DASHES). */
const CONNECTOR_DASHES = ["solid", "dash", "dot", "lgDash", "dashDot", "lgDashDot", "sysDash", "sysDot", "sysDashDot"];

/** The vendored connector line input (arrange-ops.ts connectorLine). */
export interface ConnectorLine {
  color?: string;
  widthPt?: number;
  widthEmu?: number;
  dash?: string;
}

/** add_connector -> vendored `addConnector`. */
export interface ConnectorEdit {
  op: "add_connector";
  slideIndex: number;
  /** [start, end]: two distinct top-level element ids on the slide. */
  elementIds: string[];
  kind?: PptxConnectorKind;
  arrow?: PptxConnectorArrow;
  fromSide?: PptxConnectorSide;
  toSide?: PptxConnectorSide;
  line?: ConnectorLine;
}

/** One add_connector edit -> the vendored op. Refusals are typed
 * PptxEngineError codes: conn_no_slide, conn_no_element, conn_same_element,
 * conn_bad_kind, conn_bad_arrow, conn_bad_side, conn_bad_line. */
export function buildConnectorOps(opened: OpenedPptxLike, fitWidthPx: number, edit: ConnectorEdit): PptxOp[] {
  // Geometry-free: the endpoints' frames place the connector.
  void fitWidthPx;
  const slide =
    typeof edit.slideIndex === "number" && Number.isInteger(edit.slideIndex) && edit.slideIndex >= 0
      ? opened.deck.slides[edit.slideIndex]
      : undefined;
  if (!slide) {
    throw new PptxEngineError("conn_no_slide", "add_connector: slide index " + String(edit.slideIndex) + " does not exist");
  }
  const ids = Array.isArray(edit.elementIds) ? edit.elementIds : [];
  if (ids.length !== 2 || ids.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new PptxEngineError("conn_no_element", 'add_connector needs "elementIds": [start, end] element ids');
  }
  const [from, to] = ids as [string, string];
  for (const id of ids) {
    if (!slide.elements.some((el) => el.id === id)) {
      throw new PptxEngineError("conn_no_element", 'add_connector: no element "' + id + '" on slide ' + String(edit.slideIndex));
    }
  }
  if (from === to) throw new PptxEngineError("conn_same_element", "add_connector: start and end must differ");
  if (edit.kind !== undefined && !(PPTX_CONNECTOR_KINDS as readonly unknown[]).includes(edit.kind)) {
    throw new PptxEngineError("conn_bad_kind", 'add_connector "kind" must be one of ' + PPTX_CONNECTOR_KINDS.join(", "));
  }
  if (edit.arrow !== undefined && !(PPTX_CONNECTOR_ARROWS as readonly unknown[]).includes(edit.arrow)) {
    throw new PptxEngineError("conn_bad_arrow", 'add_connector "arrow" must be one of ' + PPTX_CONNECTOR_ARROWS.join(", "));
  }
  for (const field of ["fromSide", "toSide"] as const) {
    const side: unknown = edit[field];
    if (side !== undefined && !(CONNECTOR_SIDES as readonly unknown[]).includes(side)) {
      throw new PptxEngineError("conn_bad_side", "add_connector " + field + " must be one of " + CONNECTOR_SIDES.join(", "));
    }
  }
  const line = edit.line === undefined ? undefined : normalizeLine(edit.line);
  return [
    {
      op: "addConnector",
      target: { slide: edit.slideIndex },
      from,
      to,
      ...(edit.kind === undefined ? {} : { kind: edit.kind }),
      ...(edit.arrow === undefined ? {} : { arrow: edit.arrow }),
      ...(edit.fromSide === undefined ? {} : { fromSide: edit.fromSide }),
      ...(edit.toSide === undefined ? {} : { toSide: edit.toSide }),
      ...(line === undefined ? {} : { line }),
    },
  ];
}

const badLine = (detail: string): PptxEngineError => new PptxEngineError("conn_bad_line", "add_connector line " + detail);

/** Mirrors the vendored connectorLine validation so a bad line is a typed refusal, not a guided error. */
function normalizeLine(input: unknown): ConnectorLine {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw badLine("must be an object");
  const { color, widthPt, widthEmu, dash } = input as Record<string, unknown>;
  if (color !== undefined && !(typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color))) throw badLine("color must be #RRGGBB");
  for (const [name, width] of [["widthPt", widthPt], ["widthEmu", widthEmu]] as const) {
    if (width !== undefined && !(typeof width === "number" && Number.isFinite(width) && width > 0)) throw badLine(name + " must be a number > 0");
  }
  if (dash !== undefined && !(typeof dash === "string" && CONNECTOR_DASHES.includes(dash))) throw badLine("dash must be one of " + CONNECTOR_DASHES.join(", "));
  return {
    ...(color === undefined ? {} : { color: color as string }),
    ...(widthPt === undefined ? {} : { widthPt: widthPt as number }),
    ...(widthEmu === undefined ? {} : { widthEmu: widthEmu as number }),
    ...(dash === undefined ? {} : { dash: dash as string }),
  };
}
