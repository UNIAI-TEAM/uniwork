"use client";

/**
 * useHtmlVisualEdit - the one place the HTML editor turns the H5-H8 surface on.
 *
 * Everything the visual editor needs is behind ONE switch,
 * `OFFICE_HTML_VISUAL_EDIT_FLAG` (server default on, client fallback off), and a host: the injected
 * `HtmlVisualEditHost` supplies the browser parse map and the engine's
 * `applyPatchSet`. With the flag off, no host, or a read-only document the hook
 * returns inert props - no sid-stamped copy, no inspector mount, no float
 * actions, no panel - so the editor is exactly what it was before H5.
 *
 * What it wires, all as H3 ops applied through the host:
 *   * the preview gets the sid-stamped copy and the inspector capability;
 *   * H8's text-edit / move go through the `inlineEdit` port;
 *   * H6's mark / size / colour / duplicate / delete go through `floatCommands`;
 *   * H7's style panel mounts in the overlay slot, opened from the toolbar.
 * Every edit builds its op from a FRESH context (source + parse map +
 * revision), so a second edit is never based on a stale revision.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { OFFICE_HTML_VISUAL_EDIT_FLAG, useFlag } from "@uniwork/core/feature-flags";
import type { UpstreamParseMap, UpstreamPatchSet } from "@uniwork/office-engine/html";
import type { PreviewSession } from "../../source-editor-types";
import { colourEdit, deleteEdit, duplicateEdit, fontSizeEdit, isDocumentStructure, textColourValue, toggleMarkEdit, type HtmlFloatToolbarCommands } from "./float-toolbar";
import { createVisualEditNonce } from "./nonce";
import type { HtmlInlineEditPort, InlineEditInspector } from "./inline-edit";
import { elementBySid, HtmlOpError, type HtmlOpContext } from "./ops";
import type { HtmlSelection } from "./selection/model";
import type { HtmlVisualShellProps } from "./shell";
import { stampSids } from "./stamp-sids";
import { HtmlStylePanel, mergeHtmlStyleValues, type HtmlStylePatch } from "./style-panel";
import { readStyleValues, stylePatchEdits, styleRevertEdit, type StyleEditBuilder } from "./style-panel/apply";

/**
 * What the visual editor needs from its host (the web adapter binds it to the
 * engine; views never own an engine). All three are synchronous.
 */
export interface HtmlVisualEditHost {
  /** The parse map of `text` (a browser parse5 binding, same sids every call for the same text). */
  parseMap(text: string): UpstreamParseMap;
  /** The engine revision the next patch set must be based on. */
  revision(): number;
  /** Apply through `engine.applyPatchSet`; throws when the set is stale or invalid. */
  applyPatchSet(set: UpstreamPatchSet): void;
}

export interface UseHtmlVisualEditOptions {
  host?: HtmlVisualEditHost;
  /** The source text the editor shows. */
  text: string;
  readOnly: boolean;
  presenting: boolean;
  /** The live source text, straight from the engine. */
  readText(): string;
  /** An edit committed: re-read the source, mark dirty, checkpoint. */
  onApplied(): void;
}

type VisualShellProps = Pick<
  HtmlVisualShellProps,
  "previewText" | "visualEdit" | "visualEditNonce" | "inlineEdit" | "floatCommands" | "overlay" | "sidePanel" | "onPreviewSession" | "onPreviewSelection"
>;

const INERT: Pick<VisualShellProps, "visualEdit" | "visualEditNonce" | "inlineEdit" | "floatCommands" | "overlay" | "onPreviewSession" | "onPreviewSelection"> = {
  visualEdit: false,
};

/** How long a "can't be applied" notice stays up when nothing else clears it. */
const NOTICE_MS = 6000;

export function useHtmlVisualEdit({ host, text, readOnly, presenting, readText, onApplied }: UseHtmlVisualEditOptions): VisualShellProps {
  const flag = useFlag(OFFICE_HTML_VISUAL_EDIT_FLAG, false);
  const wanted = flag && host !== undefined && !readOnly;
  // The session nonce names the sid attribute (see stamp-sids.ts) and is the
  // preview port's script nonce. A platform with no randomness stays inert.
  const nonce = useMemo(() => {
    if (!wanted) return null;
    try {
      return createVisualEditNonce();
    } catch {
      return null;
    }
  }, [wanted]);
  const active = wanted && nonce !== null;
  const hostRef = useRef(host);
  hostRef.current = host;
  const readTextRef = useRef(readText);
  readTextRef.current = readText;
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;
  // The session, not its inspector: the real preview creates the inspector only
  // after the frame loads and replaces it on every reload, so a value copied at
  // mount time is null or already retired. Read it at command time.
  const sessionRef = useRef<PreviewSession | null>(null);
  const liveInspector = useMemo<InlineEditInspector>(() => ({
    command: (command) => {
      const inspector = (sessionRef.current as { inspector?: InlineEditInspector | null } | null)?.inspector;
      return inspector ? inspector.command(command) : false;
    },
  }), []);
  const [selection, setSelection] = useState<HtmlSelection | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [aspectLocked, setAspectLocked] = useState(false);
  // Bumped after every applied edit so the panel re-reads the element's style.
  const [editCount, setEditCount] = useState(0);
  // An edit the document refused (stale revision, a gone element, CSS the
  // validator turns down): shown to the person instead of failing silently.
  const [refused, setRefused] = useState(false);
  const { t } = useTranslation(undefined, { keyPrefix: "office.html.visual" });
  useEffect(() => {
    if (!refused) return undefined;
    const timer = setTimeout(() => setRefused(false), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [refused]);
  const markRefused = useCallback(() => setRefused(true), []);

  const previewText = useMemo(() => {
    if (!active || !host || nonce === null) return text;
    try {
      return stampSids(text, host.parseMap(text), nonce);
    } catch {
      // No parse map for this source: the preview simply stays unstamped.
      return text;
    }
  }, [active, host, nonce, text]);

  const context = useCallback((): HtmlOpContext | null => {
    const current = hostRef.current;
    if (!current) return null;
    try {
      const source = readTextRef.current();
      return { text: source, map: current.parseMap(source), version: current.revision() };
    } catch {
      return null;
    }
  }, []);

  const apply = useCallback((set: UpstreamPatchSet): boolean => {
    try {
      hostRef.current?.applyPatchSet(set);
    } catch {
      // A stale or refused patch set changes nothing.
      setRefused(true);
      return false;
    }
    setRefused(false);
    setEditCount((count) => count + 1);
    onAppliedRef.current();
    return true;
  }, []);

  /** Apply edits in order, each from a fresh context; stop at the first no-op. */
  const run = useCallback((edits: readonly StyleEditBuilder[]): boolean => {
    for (const build of edits) {
      const fresh = context();
      if (!fresh) return false;
      try {
        const set = build(fresh);
        if (set === null || !apply(set)) return false;
      } catch (error) {
        // The document cannot express the intent (gone element, refused CSS).
        if (error instanceof HtmlOpError) {
          setRefused(true);
          return false;
        }
        throw error;
      }
    }
    return true;
  }, [apply, context]);

  const inlineEdit = useMemo<HtmlInlineEditPort>(() => ({
    get inspector() {
      return sessionRef.current === null ? null : liveInspector;
    },
    context,
    apply,
    refused: markRefused,
  }), [apply, context, markRefused, liveInspector]);

  const sid = selection?.sid ?? null;
  const floatCommands = useMemo<HtmlFloatToolbarCommands>(() => {
    if (sid === null) return {};
    // html, head and body take the whole page with them: no Delete / Duplicate.
    const fresh = context();
    const structural = fresh !== null && isDocumentStructure(fresh, sid);
    return {
      onBold: () => run([toggleMarkEdit(sid, "font-weight", "700")]),
      onItalic: () => run([toggleMarkEdit(sid, "font-style", "italic")]),
      onFontSizeIncrease: () => run([fontSizeEdit(sid, 1)]),
      onFontSizeDecrease: () => run([fontSizeEdit(sid, -1)]),
      onColour: (id) => run([colourEdit(sid, textColourValue(id))]),
      ...(structural
        ? {}
        : {
            onDuplicate: () => run([duplicateEdit(sid)]),
            onDelete: () => {
              if (run([deleteEdit(sid)])) {
                setPanelOpen(false);
                liveInspector.command({ type: "select", sid: null });
              }
            },
          }),
      onOpenStylePanel: () => setPanelOpen((open) => !open),
    };
  }, [context, run, sid, liveInspector]);

  const onPreviewSession = useCallback((session: PreviewSession | null) => {
    sessionRef.current = session;
  }, []);
  const onPreviewSelection = useCallback((next: HtmlSelection | null) => {
    setSelection(next);
    setRefused(false);
    if (next === null) setPanelOpen(false);
  }, []);

  const panelValues = useMemo(() => {
    void editCount;
    if (!active || !panelOpen || sid === null) return null;
    const fresh = context();
    if (!fresh) return null;
    const read = readStyleValues(fresh, sid);
    return {
      values: mergeHtmlStyleValues(read, { size: { aspectLocked } }),
      isImage: elementBySid(fresh.map, sid)?.tag === "img",
    };
  }, [active, panelOpen, sid, editCount, aspectLocked, context]);

  const panel =
    panelValues === null || sid === null ? null : (
      <HtmlStylePanel
        values={panelValues.values}
        isImage={panelValues.isImage}
        onChange={(patch: HtmlStylePatch) => {
          if (patch.size?.aspectLocked !== undefined) setAspectLocked(patch.size.aspectLocked);
          run(stylePatchEdits(sid, patch));
        }}
        onRevert={() => run([styleRevertEdit(sid)])}
      />
    );
  // The status region is mounted (empty) from the start and only receives its
  // text when an edit is refused: several screen readers announce changes inside
  // an existing live region, not one inserted already holding its text.
  const overlay = (
    <div className="absolute end-3 top-3 z-20 flex flex-col items-end gap-2">
      <p
        role="status"
        className={refused ? "rounded-md border bg-popover px-3 py-2 text-caption text-popover-foreground shadow-md" : "sr-only"}
      >
        {refused ? t("refused") : null}
      </p>
    </div>
  );

  if (!active) return { previewText: text, ...INERT };
  return {
    previewText,
    visualEdit: !presenting,
    visualEditNonce: nonce,
    inlineEdit,
    floatCommands,
    overlay,
    sidePanel: panel,
    onPreviewSession,
    onPreviewSelection,
  };
}
