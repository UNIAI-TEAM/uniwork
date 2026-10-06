/**
 * useHtmlInlineEdit — the H8 bridge that finally ACTS on the H5 selection.
 *
 * H5 publishes a read-only selection, H6 renders the toolbar with injected
 * callbacks. This hook is what the shell wires those callbacks to:
 *
 *   * "edit text" sends the S1 inspector command `begin-text-edit` for the
 *     selected `sid` (the frame then makes the element contenteditable);
 *   * the frame's `text-edit-commit` event, arriving on the shell's preview
 *     sink, is validated as UNTRUSTED input and turned into an H3 `set_text` /
 *     `set_inner_html` op applied through the caller's engine port;
 *   * "move up"/"move down" build the H3 `move` op; `resize` builds the
 *     `set_style` op from a validated numeric size.
 *
 * The hook owns no document and no engine: the caller injects an
 * `HtmlInlineEditPort` that holds the live inspector channel, the op context
 * (source + parse map + revision) and the apply path. That keeps views free of
 * engine ownership and makes every branch unit-testable with a fake port.
 *
 * The whole surface is gated on the SAME flag H5/H6 use (`OFFICE_HTML_VISUAL_EDIT_FLAG`,
 * default OFF). With it off the hook subscribes to nothing, sends no command
 * and applies no op, so a flag-off build is behaviourally identical to before
 * H8. A malformed frame payload is dropped the same way - the op is only built
 * from a validated commit and a live context, and an op the document cannot
 * express (a void element, a missing target) is swallowed, never surfaced as a
 * crash.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFlag } from "@uniwork/core/feature-flags";
import type { UpstreamPatchSet } from "@uniwork/office-engine/html";
import { HtmlOpError, type HtmlOpContext } from "../ops";
import { OFFICE_HTML_VISUAL_EDIT_FLAG, type HtmlSelection, type PreviewEventSink } from "../selection/model";
import { moveSelectionOp, resizeSelectionOp, textEditOp, type ResizeInput } from "./ops";
import { parseTextEditCommit } from "./model";

/** The inspector command channel H8 needs, structurally (views must not import
 * the web host's `preview-inspector.ts`). The real session's `command` accepts
 * a superset, so it satisfies this shape without a cast. */
export interface InlineEditInspector {
  command(command: InlineEditInspectorCommand): boolean;
}

export type InlineEditInspectorCommand =
  | { type: "begin-text-edit"; sid: number }
  | { type: "cancel-text-edit" }
  | { type: "select"; sid: number | null };

/**
 * Everything H8 needs from its host. All three are synchronous and total: a
 * missing context or a refused apply returns null/false and the bridge simply
 * does nothing.
 */
export interface HtmlInlineEditPort {
  /** The live visual-edit inspector channel, or null with no such session. */
  inspector: InlineEditInspector | null;
  /** The current op context (source text + parse map + revision), or null. */
  context(): HtmlOpContext | null;
  /** Apply an op's patch set through the engine; true when the source changed. */
  apply(set: UpstreamPatchSet): boolean;
  /** An op the document cannot express was refused: tell the person. */
  refused?(): void;
}

/** The toolbar callbacks H8 contributes; absent means "not wired". */
export interface HtmlInlineEditCommands {
  onEditText?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export interface HtmlInlineEditController {
  /** Merge into the float toolbar's `commands`. */
  commands: HtmlInlineEditCommands;
  /** Commit a resize (H7's panel / a future drag handle). */
  resize(size: ResizeInput): boolean;
}

export interface UseHtmlInlineEditOptions {
  /** The shell's fan-out for forwarded preview events (the commit stream). */
  sink: PreviewEventSink;
  /** The committed selection the shell publishes (never hover). */
  selection: HtmlSelection | null;
  /** The injected host port; absent disables every action. */
  port?: HtmlInlineEditPort;
}

/** Build an op from the live context and apply it; a rejected op is "no op". */
function buildAndApply(port: HtmlInlineEditPort | undefined, build: (context: HtmlOpContext) => UpstreamPatchSet | null): boolean {
  if (!port) return false;
  const context = port.context();
  if (!context) return false;
  try {
    const set = build(context);
    return set === null ? false : port.apply(set);
  } catch (error) {
    // A void element, a missing target, an unmovable destination: the document
    // cannot express the intent, so nothing happens (never a crash).
    if (error instanceof HtmlOpError) {
      port.refused?.();
      return false;
    }
    throw error;
  }
}

export function useHtmlInlineEdit({ sink, selection, port }: UseHtmlInlineEditOptions): HtmlInlineEditController {
  const enabled = useFlag(OFFICE_HTML_VISUAL_EDIT_FLAG, false);
  const portRef = useRef(port);
  portRef.current = port;
  const sid = enabled ? selection?.sid ?? null : null;
  const sidRef = useRef(sid);
  sidRef.current = sid;

  // The frame reports a committed edit on the same sink H5 listens to. The
  // payload is untrusted: it is validated, then mapped to an H3 op and applied.
  useEffect(() => {
    if (!enabled) return undefined;
    return sink.subscribe((event) => {
      if (event.type === "ready") {
        // Every applied edit re-renders the frame, and the new inspector starts
        // with nothing selected: ask it to pick the selection again so it
        // reports a fresh rect (a width change would otherwise leave the
        // outline at the old size). A sid that no longer exists comes back as
        // "select null" and clears the selection.
        const current = sidRef.current;
        if (current !== null) portRef.current?.inspector?.command({ type: "select", sid: current });
        return;
      }
      const commit = parseTextEditCommit(event);
      if (commit === null) return;
      buildAndApply(portRef.current, (context) => textEditOp(context, commit));
    });
  }, [enabled, sink]);

  const onEditText = useCallback(() => {
    if (sid === null) return;
    portRef.current?.inspector?.command({ type: "begin-text-edit", sid });
  }, [sid]);

  const onMoveUp = useCallback(() => {
    if (sid === null) return;
    buildAndApply(portRef.current, (context) => moveSelectionOp(context, sid, "up"));
  }, [sid]);

  const onMoveDown = useCallback(() => {
    if (sid === null) return;
    buildAndApply(portRef.current, (context) => moveSelectionOp(context, sid, "down"));
  }, [sid]);

  const resize = useCallback((size: ResizeInput): boolean => {
    if (sid === null) return false;
    return buildAndApply(portRef.current, (context) => resizeSelectionOp(context, sid, size));
  }, [sid]);

  const commands = useMemo<HtmlInlineEditCommands>(
    () => (enabled && sid !== null ? { onEditText, onMoveUp, onMoveDown } : {}),
    [enabled, sid, onEditText, onMoveUp, onMoveDown],
  );

  return useMemo(() => ({ commands, resize }), [commands, resize]);
}
