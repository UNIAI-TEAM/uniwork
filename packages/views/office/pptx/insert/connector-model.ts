/**
 * UNI-939 T02/T03 - the connector pane's pure model: line style (colour, width,
 * dash), explicit attach sides and the two edits they leave through.
 *
 * A new connector carries its look and sides on the `add_connector` edit (the
 * vendored `addConnector` writes the stroke and pins the ends in one op, so one
 * history entry); an existing connector is restyled with `set_stroke`. The
 * defaults mean "leave it to the engine": sides `auto` send no side, and the
 * default line (black, 1pt, solid) sends no `line`.
 */
import type { PptxConnectorSide, PptxEdit } from "@uniwork/office-engine/pptx";
import { PPTX_FORMAT_DASHES, buildStrokeEdit, isFormatColor, normalizeFormatHex, parsePoints, pointsToEmu, type PptxFormatDash } from "../format/format-model";
import { PPTX_CONNECTOR_DEFAULT_LINE } from "./insert-defaults";
import type { PptxInsertConnectorRequest } from "./insert-model";

/** `auto` keeps the engine's closest-side pick; the rest pin that end to a side. */
export const PPTX_CONNECTOR_SIDE_CHOICES = ["auto", "top", "right", "bottom", "left"] as const;
export type PptxConnectorSideChoice = (typeof PPTX_CONNECTOR_SIDE_CHOICES)[number];

/** The vendored connectorLine has no `lgDashDotDot`, so the pane does not offer it. */
export const PPTX_CONNECTOR_DASHES: readonly PptxFormatDash[] = PPTX_FORMAT_DASHES.filter((dash) => dash !== "lgDashDotDot");

/** The pane's line state; `widthPt` is the raw field text so a half-typed value stays editable. */
export interface PptxConnectorLineChoice {
  color: string;
  widthPt: string;
  dash: PptxFormatDash;
}

type ConnectorRequestLine = NonNullable<PptxInsertConnectorRequest["line"]>;

/** The validated line, or null while the colour or width is not usable. */
export function connectorLineOf(choice: PptxConnectorLineChoice): { color: string; widthPt: number; dash: PptxFormatDash } | null {
  const widthPt = parsePoints(choice.widthPt);
  if (widthPt === null || pointsToEmu(widthPt) <= 0 || !isFormatColor(choice.color)) return null;
  return { color: normalizeFormatHex(choice.color), widthPt, dash: choice.dash };
}

/** The `line` an add_connector request carries; undefined at the default look. */
export function connectorRequestLine(choice: PptxConnectorLineChoice): ConnectorRequestLine | undefined {
  const line = connectorLineOf(choice);
  if (!line) return undefined;
  const base = PPTX_CONNECTOR_DEFAULT_LINE;
  if (line.color.toLowerCase() === base.color && line.widthPt === base.widthPt && line.dash === base.dash) return undefined;
  return { color: line.color, widthEmu: pointsToEmu(line.widthPt), ...(line.dash === "solid" ? {} : { dash: line.dash }) };
}

/** A side choice -> the request field; `auto` sends nothing. */
export function connectorSideOf(choice: PptxConnectorSideChoice): PptxConnectorSide | undefined {
  return choice === "auto" ? undefined : choice;
}

/** The add_connector edit for a request (the host's channel). */
export function connectorInsertEdit(request: PptxInsertConnectorRequest): Extract<PptxEdit, { op: "add_connector" }> {
  return {
    op: "add_connector",
    slideIndex: request.slideIndex,
    elementIds: [request.from, request.to],
    kind: request.kind,
    arrow: request.arrow,
    ...(request.fromSide === undefined ? {} : { fromSide: request.fromSide }),
    ...(request.toSide === undefined ? {} : { toSide: request.toSide }),
    ...(request.line === undefined ? {} : { line: request.line }),
  };
}

/** `set_stroke` on an existing connector (a connector is a `shape` element for the engine). */
export function connectorStrokeEdit(slideIndex: number, elementId: string, choice: PptxConnectorLineChoice): Extract<PptxEdit, { op: "set_stroke" }> {
  const line = connectorLineOf(choice);
  if (!line) throw new Error("connector line is not valid");
  // A solid stroke always builds a set_stroke edit.
  return buildStrokeEdit(slideIndex, elementId, { kind: "solid", ...line }) as Extract<PptxEdit, { op: "set_stroke" }>;
}
