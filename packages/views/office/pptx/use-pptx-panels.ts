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
import { useCallback, useMemo, useState, type ReactNode } from "react";
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

/** Ribbon commands that open a panel instead of running an action. */
const COMMAND_PANELS: Partial<Record<PptxCommandId, PptxPanelKind>> = {
  "speaker-notes": "notes",
  animations: "animations",
  charts: "charts",
  tables: "tables",
};

/** Panels that write to the deck: without an edit channel their ribbon item is
 *  disabled with the reason instead of opening a panel that can only refuse. */
const EDITING_PANELS: readonly PptxPanelKind[] = [
  "design", "insert", "animations", "transitions", "tables", "charts", "format",
  "text-format", "links", "comments", "headerfooter", "media",
];

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
}

export function usePptxPanels(input: PptxPanelsInput) {
  const { activeTab, contextual, panelKind, panel, panelData, applyEdit: hostApply, bulkEdit, onError, slideIndex, slides, boxes, selectedIds, rendition, reorder, remove, onSelectSlide, loadLayouts, showItems } = input;
  // Same fallback as buildPptxPanel: an unregistered panel union travels the
  // generic handle edit port (WIRE-KINDS owns the engine registration).
  const applyEdit = useMemo(
    () => hostApply ?? (bulkEdit ? (one: PptxPanelEdit) => bulkEdit([one as PptxEdit]) : undefined),
    [bulkEdit, hostApply],
  );
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

  /** Returns true when the command was a panel command (and opened it). */
  const openCommandPanel = useCallback((id: PptxCommandId) => {
    const kind = COMMAND_PANELS[id];
    if (!kind) return false;
    openPanel(kind);
    return true;
  }, [openPanel]);

  const panelDisabled = useMemo<Partial<Record<PptxPanelKind, string>>>(() => {
    if (applyEdit) return {};
    return Object.fromEntries(EDITING_PANELS.map((kind) => [kind, "office.pptx.reasons.edit_unbound"]));
  }, [applyEdit]);

  const anchor = useMemo(() => pptxPanelSelection(boxes, selectedIds), [boxes, selectedIds]);
  const textState = useMemo(() => pptxTextFormatState(rendition, anchor.elementId), [anchor.elementId, rendition]);
  // The text-format panel seeds its controls from the selection's live formatting.
  const selection = useMemo(() => ({ ...anchor, textFormat: textState }), [anchor, textState]);
  const target = useMemo<PptxFormatTarget>(
    () => ({ slideIndex, elementId: selection.elementId, elementType: selection.elementType, ids: selection.ids }),
    [selection, slideIndex],
  );
  const groupItems = useMemo<Record<string, readonly RibbonItem[]>>(() => {
    const apply = applyEdit ? (edit: PptxPanelEdit) => { void applyEdit(edit).catch(onError); } : undefined;
    const text = { target, state: textState, ...(apply ? { apply } : {}), onMoreOptions: () => openPanel("text-format") };
    return {
      font: pptxFontGroupItems(text),
      paragraph: pptxParagraphGroupItems(text),
      arrange: pptxArrangeGroupItems({ target, ...(reorder ? { reorder } : {}), ...(remove ? { remove } : {}) }),
      ...(showItems ? { show: showItems } : {}),
    };
  }, [applyEdit, onError, openPanel, remove, reorder, showItems, target, textState]);

  const placement = !panel && activeKind ? pptxPanelPlacement(activeKind) : "aside";
  const node = panel ?? buildPptxPanel({
    placement,
    ...(activeKind ? { panelKind: activeKind } : {}),
    ...(applyEdit ? { onApplyEdit: applyEdit } : {}),
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
