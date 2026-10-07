/**
 * The H3 op mapping for the H8 inline-edit bridge. PURE: every function takes
 * the engine's op context (source text + parse map + revision) and returns the
 * patch set the caller applies through `engine.applyPatchSet` - nothing here
 * splices text, touches a DOM or sends an inspector command.
 *
 * Two intents are mapped:
 *
 *   * a committed text edit (`text-edit-commit`) -> `set_text` when the
 *     element holds plain text, `set_inner_html` when it holds child markup.
 *     BOTH branches write ESCAPED text: the committed payload came from the
 *     frame and is untrusted, so it is never re-interpreted as markup.
 *   * move up/down -> the `move` op with the sibling destination H3's
 *     `move-target` resolves (null at the edge of the sibling list).
 *   * resize -> the `set_style` op with clamped pixel width/height.
 *
 * `null` means "nothing to do": the caller applies no patch set. An op the
 * document cannot express (a void element, a missing target) throws
 * `HtmlOpError` exactly like the rest of the ops module; the controller turns
 * that into "no op" rather than a crash.
 */
import type { UpstreamPatchSet } from "@uniwork/office-engine/html";
import {
  escapeHtmlText,
  move,
  setInnerHtml,
  setStyle,
  setText,
  siblingMoveDestination,
  type HtmlOpContext,
  type MoveDirection,
} from "../ops";
import { clampResizeValue, type InlineTextCommit } from "./model";

/** True when the element's direct children include an element (not just text). */
function hasChildElements(context: HtmlOpContext, sid: number): boolean {
  return context.map.elements.some((element) => element.parentSid === sid);
}

/**
 * The words of the element's source the way the frame reports them: entities
 * decoded, scripts gone (the preview strips them), whitespace collapsed and
 * trimmed. Null when there is no DOM parser to ask (the caller then edits).
 */
function normalisedSourceText(context: HtmlOpContext, sid: number): string | null {
  const element = context.map.bySid.get(sid);
  if (!element || typeof DOMParser === "undefined") return null;
  const inner = context.text.slice(element.inner[0], element.inner[1]);
  const body = new DOMParser().parseFromString(`<body>${inner}`, "text/html").body;
  for (const script of Array.from(body.querySelectorAll("script"))) script.remove();
  return (body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The op for a committed inline text edit, or null when the commit says what
 * the element already says. The frame reports a commit on every blur, even with
 * no typing, and its text is flattened and whitespace-collapsed: writing it
 * back would silently drop the element's inline markup, `&nbsp;`, `<br>` and
 * line breaks, so an unchanged commit must leave the source alone.
 *
 * A plain-text element keeps its tag and swaps only its text (`set_text`); an
 * element with child markup has its whole inner content replaced
 * (`set_inner_html`), which is what the frame's flattened edit means. Both
 * escape the committed text, so a payload such as `<img onerror=...>` lands as
 * inert text and never as markup.
 */
export function textEditOp(context: HtmlOpContext, commit: InlineTextCommit): UpstreamPatchSet | null {
  if (normalisedSourceText(context, commit.sid) === commit.text) return null;
  if (hasChildElements(context, commit.sid)) {
    return setInnerHtml(context, { sid: commit.sid }, escapeHtmlText(commit.text));
  }
  return setText(context, { sid: commit.sid }, commit.text);
}

/**
 * The op for a move up/down command, or null at the edge of the sibling list.
 * The destination is H3's `siblingMoveDestination`, so the "inside itself"
 * and "own edge" rejections stay in one place.
 */
export function moveSelectionOp(
  context: HtmlOpContext,
  sid: number,
  direction: MoveDirection,
): UpstreamPatchSet | null {
  const destination = siblingMoveDestination(context.map, sid, direction);
  if (!destination) return null;
  return move(context, { sid }, destination);
}

/** A pixel size to write; either dimension may be omitted. */
export interface ResizeInput {
  width?: number;
  height?: number;
}

/**
 * The op for a resize, or null when neither dimension is a usable number. Each
 * value is clamped by the model's arithmetic, so a NaN or an absurd size never
 * reaches the document.
 */
export function resizeSelectionOp(context: HtmlOpContext, sid: number, size: ResizeInput): UpstreamPatchSet | null {
  const width = size.width === undefined ? undefined : clampResizeValue(size.width);
  const height = size.height === undefined ? undefined : clampResizeValue(size.height);
  if (width === null || height === null) return null;
  if (width === undefined && height === undefined) return null;
  return setStyle(context, { sid }, { width, height });
}
