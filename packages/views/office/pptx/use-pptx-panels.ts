"use client";

/**
 * Which side panel the PPTX editor mounts, and the ribbon items that drive it
 * (UNI-927 W5, F-01/F-10).
 *
 * Order of precedence: a host-supplied `panelKind` override, then a panel the
 * user opened from a ribbon item or launcher, then the default panel of the
 * active tab (contextual tabs map to their object's panel). Switching tabs drops
 * the user's pick so every tab opens on its own default; picking the open panel
 * again closes it.
 *
 * It also builds the injected ribbon groups (Home Font/Paragraph, contextual
 * Arrange) from the live selection, so formatting is one click away and bound to
 * the same single edit channel every panel uses.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { RibbonItem } from "../ribbon";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import type { PptxNodeBox, PptxRenderSlide } from "./canvas/render-tree";
import type { PptxCommandId } from "./command-map";
import {
  buildPptxPanel,
  pptxPanelForContextualTab,
  pptxPanelForTab,
  pptxPanelPlacement,
  pptxPanelSelection,
  type PptxPanelData,
  type PptxPanelEdit,
  type PptxPanelKind,
} from "./pptx-panel-host";
import type { PptxRibbonContextualSelection } from "./pptx-ribbon";
import { pptxArrangeGroupItems, pptxFontGroupItems, pptxParagraphGroupItems, pptxTextFormatState, type PptxFormatTarget } from "./ribbon-format-items";
import type { PptxSlideView } from "./slide-rail";
import { pptxTextFormatAllowed } from "./text/text-format-model";

/** Ribbon commands that open a panel instead of running an action. */
const COMMAND_PANELS: Partial<Record<PptxCommandId, PptxPanelKind>> = {
  "speaker-notes": "notes",
  animations: "animations",
  charts: "charts",
  tables: "tables",
};

/** Panels that write to the deck: without an edit channel their ribbon item is
 *  disabled with the reason instead of opening a panel that can only refuse.
 *  Notes and comments read the deck too, so they open read-only instead (W5 review F3). */
const EDITING_PANELS: readonly PptxPanelKind[] = [
  "design", "insert", "animations", "transitions", "tables", "charts", "format",
  "text-format", "links", "headerfooter", "media",
];

/** The element ids an edit result says it minted (`{ createdIds }` or `{ createdId }`). */
function createdIdsOf(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const { createdIds, createdId } = result as { createdIds?: unknown; createdId?: unknown };
  if (Array.isArray(createdIds)) return createdIds.filter((id): id is string => typeof id === "string" && id.length > 0);
  return typeof createdId === "string" && createdId.length > 0 ? [createdId] : [];
}

function reportCreated(result: unknown, onCreated: ((ids: readonly string[]) => void) | undefined): unknown {
  const created = createdIdsOf(result);
  if (created.length > 0) onCreated?.(created);
  return result;
}

const CONTEXTUAL_FLAG: Record<string, keyof PptxRibbonContextualSelection> = {
  "context-shape": "shape",
  "context-picture": "picture",
  "context-table": "table",
  "context-chart": "chart",
};

export interface PptxPanelsInput {
  activeTab: string;
  contextual: PptxRibbonContextualSelection | undefined;
  /** Host override (wire-round seam); wins over everything. */
  panelKind?: PptxPanelKind;
  /** Host-composed panel node; wins over the built one. */
  panel?: ReactNode;
  panelData?: PptxPanelData;
  applyEdit?: (edit: PptxPanelEdit) => Promise<unknown>;
  /** The editor handle edit port; the fallback channel when the host binds no applyEdit. */
  bulkEdit?: (edits: readonly PptxEdit[]) => Promise<unknown>;
  onError: (error: unknown) => void;
  slideIndex: number;
  slides: readonly PptxSlideView[];
  boxes: readonly PptxNodeBox[];
  selectedIds: readonly string[];
  rendition: PptxRenderSlide | null;
  reorder?: (dir: "front" | "back") => void;
  remove?: () => void;
  /** Sorter ports: select a slide in the editor, list the deck's layouts. */
  onSelectSlide?: (index: number) => void;
  loadLayouts?: () => Promise<readonly { name: string; path: string }[]>;
  /** Slide Show tab items, built by the editor that owns the show state. */
  showItems?: readonly RibbonItem[];
  /** Element ids an applied edit minted, so the editor can select the new insert. */
  onCreated?: (ids: readonly string[]) => void;
  /** The editor root, to move focus into a panel a command re-opens. */
  rootRef?: RefObject<HTMLElement | null>;
}

export function usePptxPanels(input: PptxPanelsInput) {
  const { activeTab, contextual, panelKind, panel, panelData, applyEdit: hostApply, bulkEdit, onError, slideIndex, slides, boxes, selectedIds, rendition, reorder, remove, onSelectSlide, loadLayouts, showItems, onCreated, rootRef } = input;
  // Same fallback as buildPptxPanel: an unregistered panel union travels the
  // generic handle edit port (WIRE-KINDS owns the engine registration).
  const onCreatedRef = useRef(onCreated);
  useEffect(() => { onCreatedRef.current = onCreated; }, [onCreated]);
  // Every panel edit reports the ids it minted, so an insert ends selected.
  const applyEdit = useMemo(() => {
    const base = hostApply ?? (bulkEdit ? (one: PptxPanelEdit) => bulkEdit([one as PptxEdit]) : undefined);
    if (!base) return undefined;
    return async (edit: PptxPanelEdit) => reportCreated(await base(edit), onCreatedRef.current);
  }, [bulkEdit, hostApply]);
  // W9 review F2: one gesture over several elements is ONE call on the handle's
  // array channel (one revision, one history entry on the host). A host that bound
  // only the single-edit port gets the edits in order, one call each.
  const applyEdits = useMemo(() => {
    if (!applyEdit) return undefined;
    return async (edits: readonly PptxPanelEdit[]): Promise<unknown> => {
      if (edits.length === 1) return applyEdit(edits[0]!);
      if (bulkEdit) return reportCreated(await bulkEdit(edits as readonly PptxEdit[]), onCreatedRef.current);
      let result: unknown;
      for (const edit of edits) result = await applyEdit(edit);
      return result;
    };
  }, [applyEdit, bulkEdit]);
  // The pick is remembered per tab: a pick made on another tab never leaks.
  const [pick, setPick] = useState<{ tab: string; kind: PptxPanelKind | null } | null>(null);
  const contextualLive = (tab: string) => {
    const flag = CONTEXTUAL_FLAG[tab];
    return flag ? contextual?.[flag] === true : true;
  };
  const tabDefault = contextualLive(activeTab) ? pptxPanelForContextualTab(activeTab) ?? pptxPanelForTab(activeTab) : null;
  const userPick = pick && pick.tab === activeTab ? pick : null;
  const activeKind: PptxPanelKind | null = panelKind ?? (userPick ? userPick.kind : tabDefault);

  const openPanel = useCallback((kind: PptxPanelKind) => {
    setPick((current) => {
      const currentKind = current && current.tab === activeTab ? current.kind : tabDefault;
      return { tab: activeTab, kind: currentKind === kind ? null : kind };
    });
  }, [activeTab, tabDefault]);

  // W5 review F12: a panel command never closes a pane it did not open. The
  // first press on a pane already open by default claims and focuses it; only
  // a second press (now the user's own pick) toggles it closed.
  const [focusRequest, setFocusRequest] = useState(0);
  const openCommandPanel = useCallback((id: PptxCommandId) => {
    const kind = COMMAND_PANELS[id];
    if (!kind) return false;
    if (activeKind === kind && userPick?.kind !== kind) {
      setPick({ tab: activeTab, kind });
      setFocusRequest((n) => n + 1);
    } else {
      if (activeKind !== kind) setFocusRequest((n) => n + 1);
      openPanel(kind);
    }
    return true;
  }, [activeKind, activeTab, openPanel, userPick?.kind]);
  useEffect(() => {
    if (focusRequest === 0) return;
    const host = rootRef?.current?.querySelector("[data-pptx-panel-host]");
    host?.querySelector<HTMLElement>("textarea:not([disabled]), input:not([disabled]), [contenteditable='true'], button:not([disabled])")?.focus();
  }, [focusRequest, rootRef]);

  const panelDisabled = useMemo<Partial<Record<PptxPanelKind, string>>>(() => {
    if (applyEdit) return {};
    return Object.fromEntries(EDITING_PANELS.map((kind) => [kind, "office.pptx.reasons.edit_unbound"]));
  }, [applyEdit]);

  const anchor = useMemo(() => pptxPanelSelection(boxes, selectedIds), [boxes, selectedIds]);
  const textState = useMemo(() => pptxTextFormatState(rendition, anchor.elementId), [anchor.elementId, rendition]);
  // W5 review F9: Font/Paragraph edits reach every selected element that takes
  // text formatting, anchor first, not only the anchor.
  const textIds = useMemo(
    () => selectedIds.filter((id) => pptxTextFormatAllowed(boxes.find((entry) => entry.sourceId === id)?.type)),
    [boxes, selectedIds],
  );
  // The text-format panel seeds its controls from the selection's live formatting
  // and (W9 review F6) formats the same `textIds` the ribbon does.
  const selection = useMemo(() => ({ ...anchor, textIds, textFormat: textState }), [anchor, textIds, textState]);
  const target = useMemo<PptxFormatTarget>(
    () => ({ slideIndex, elementId: selection.elementId, elementType: selection.elementType, ids: selection.ids, textIds }),
    [selection, slideIndex, textIds],
  );
  const groupItems = useMemo<Record<string, readonly RibbonItem[]>>(() => {
    const apply = applyEdits ? (edits: readonly PptxPanelEdit[]) => { void applyEdits(edits).catch(onError); } : undefined;
    // W5 review F5: "More colors…" goes through the same guard as every other
    // way into the text-format panel.
    const moreBlocked = Boolean(panelDisabled["text-format"]);
    const onMoreOptions = () => { if (!moreBlocked) openPanel("text-format"); };
    const text = { target, state: textState, ...(apply ? { apply } : {}), onRefused: onError, onMoreOptions };
    return {
      font: pptxFontGroupItems(text),
      paragraph: pptxParagraphGroupItems(text),
      arrange: pptxArrangeGroupItems({ target, ...(reorder ? { reorder } : {}), ...(remove ? { remove } : {}) }),
      ...(showItems ? { show: showItems } : {}),
    };
  }, [applyEdits, onError, openPanel, panelDisabled, remove, reorder, showItems, target, textState]);

  const placement = !panel && activeKind ? pptxPanelPlacement(activeKind) : "aside";
  const node = panel ?? buildPptxPanel({
    placement,
    ...(activeKind ? { panelKind: activeKind } : {}),
    ...(applyEdit ? { onApplyEdit: applyEdit } : {}),
    ...(applyEdits ? { onApplyEdits: applyEdits } : {}),
    ...(bulkEdit ? { edit: bulkEdit } : {}),
    onError,
    slideIndex,
    slides,
    selection,
    ...(panelData ? { data: panelData } : {}),
    ...(onSelectSlide ? { onSelectSlide } : {}),
    ...(loadLayouts ? { loadLayouts } : {}),
  });

  return { activeKind, openPanel, openCommandPanel, panelDisabled, groupItems, placement, node };
}
