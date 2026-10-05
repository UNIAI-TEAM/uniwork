"use client";

/**
 * The PPTX side-panel host (UNI-927 wire round).
 *
 * One dumb switch from the editor's active surface to the self-contained panel
 * that belongs to it: Design -> PptxDesignPanel, Insert -> PptxInsertPanel,
 * Animations -> PptxAnimationsPanel, Transitions -> PptxTransitionsPanel,
 * Sorter -> PptxSorterPanel, Tables -> PptxTablesPanel, Charts -> PptxChartsPanel,
 * Format -> PptxFormatPanel, Links -> PptxLinkEditor,
 * Notes -> PptxNotesPane, Comments -> PptxCommentsPanel,
 * Header/footer -> PptxHeaderFooterPanel, Media -> PptxMediaPanel.
 *
 * It owns no write path. Every panel port is passed in; when a port is absent the
 * panel renders its own honest disabled state. Panels with a per-edit port route
 * it to `onApplyEdit` (one PptxEdit per call), the sorter routes its bulk channel
 * to `onEdit` (the editor handle's `edit`), and nothing here touches the engine,
 * the transport or the save coordinator directly.
 */
import type { ReactNode } from "react";
import type { FormatEdit, HeaderFooterEdit, MediaEdit, NotesCommentEdit, PptxEdit, PptxSlideTransitionRead } from "@uniwork/office-engine/pptx";
import type { PptxNodeBox } from "./canvas/render-tree";
import type { PptxSlideView } from "./slide-rail";
import type { PptxAnimationEntry } from "./animations";
import type { PptxComment } from "./comments/comments-panel-state";
import { PptxCommentsPanel } from "./comments/comments-panel";
import type { PptxHeaderFooterSettings } from "./headerfooter/headerfooter-model";
import { PptxHeaderFooterPanel } from "./headerfooter";
import { PptxMediaPanel } from "./media";
import { PptxNotesPane } from "./notes/notes-pane";
import type { PptxRibbonContextualSelection } from "./pptx-ribbon";
import { PptxAnimationsPanel } from "./animations";
import { PptxChartsPanel } from "./charts";
import { PptxDesignPanel } from "./design";
import { PptxFormatPanel } from "./format";
import { PptxInsertPanel } from "./insert";
import type { PptxInsertElementRef } from "./insert/insert-model";
import { PptxTextFormatPanel, type PptxTextFormatPanelProps } from "./text/pptx-text-format-panel";
import { PptxLinkEditor } from "./links";
import { PptxSorterPanel } from "./sorter";
import type { PptxSorterLayout } from "./sorter/sorter-helpers";
import { PptxTablesPanel } from "./tables";
import { PptxTransitionsPanel } from "./transitions";
import type { PptxTabId } from "./pptx-ribbon";

/** The panel surfaces the host can render. */
export type PptxPanelKind =
  | "design"
  | "sorter"
  | "insert"
  | "animations"
  | "transitions"
  | "tables"
  | "charts"
  | "format"
  | "text-format"
  | "links"
  | "notes"
  | "comments"
  | "headerfooter"
  | "media";

/**
 * Every edit a panel can emit. The engine registers only the base kinds in the
 * `PptxEdit` union today (WIRE-KINDS owns that registration), so the generic
 * channel accepts the committed panel unions too and the single cast happens
 * once, in `buildPptxPanel`'s fallback. When the engine registers them the cast
 * becomes a no-op; it is never a second write path.
 */
export type PptxPanelEdit = PptxEdit | FormatEdit | NotesCommentEdit | HeaderFooterEdit | MediaEdit;

/** The deck data the newly mounted panels read; all optional so a host that
 *  cannot supply one leaves the panel honestly disabled/empty. */
export interface PptxPanelData {
  notes?: string | null;
  notesLoading?: boolean;
  /** The current slide's transition + advance time as the engine reads it (X1). */
  transition?: PptxSlideTransitionRead | null;
  /** The current slide's animation timeline, play order (X1). */
  animations?: readonly PptxAnimationEntry[] | null;
  comments?: readonly PptxComment[];
  commentsLoading?: boolean;
  defaultAuthor?: string;
  headerFooterSettings?: PptxHeaderFooterSettings | null;
  headerFooterLoading?: boolean;
  mediaElementId?: string | null;
  /** Top-level elements of the current slide for the insert panel pickers. */
  insertElements?: readonly PptxInsertElementRef[];
  readonly?: boolean;
}

/** The live-slide read ports an editor handle may carry (both shipped hosts do). */
interface PptxMotionReadPorts {
  slideTransition?: (slideIndex: number) => PptxSlideTransitionRead | null;
  slideAnimations?: (slideIndex: number) => readonly PptxAnimationEntry[] | null;
}

/**
 * X1 (R2-1, R2-2): the transitions/animations panel data read off the editor
 * handle for one slide. A port the handle lacks stays absent (the panel keeps
 * its unread state); a read that throws (released session, no such slide)
 * reads as null, never as a fabricated value.
 */
export function readPptxPanelMotion(handle: unknown, slideIndex: number): Pick<PptxPanelData, "transition" | "animations"> {
  const ports = (handle ?? {}) as PptxMotionReadPorts;
  const read = <T,>(port: ((index: number) => T | null) | undefined): T | null | undefined => {
    if (typeof port !== "function") return undefined;
    try { return port.call(handle, slideIndex) ?? null; } catch { return null; }
  };
  const transition = read(ports.slideTransition);
  const animations = read(ports.slideAnimations);
  return {
    ...(transition !== undefined ? { transition } : {}),
    ...(animations !== undefined ? { animations } : {}),
  };
}

/**
 * R4: which contextual tabs the live selection makes reachable, derived from the
 * selected source ids and the rendition node types. Returns undefined when no
 * object of a contextual kind is selected, so the caller omits the prop.
 */
export function pptxContextualSelection(
  boxes: readonly PptxNodeBox[],
  ids: readonly string[],
): PptxRibbonContextualSelection | undefined {
  if (ids.length === 0) return undefined;
  const byId = new Map(boxes.map((box) => [box.sourceId, box.type]));
  const selection: PptxRibbonContextualSelection = {};
  for (const id of ids) {
    switch (byId.get(id)) {
      case "picture": selection.picture = true; break;
      case "shape":
      case "text": selection.shape = true; break;
      case "table": selection.table = true; break;
      case "chart": selection.chart = true; break;
      default: break;
    }
  }
  return Object.keys(selection).length > 0 ? selection : undefined;
}

/** Seed values for the text-format controls (the selection current formatting). */
export type PptxTextFormatSeed = Pick<
  PptxTextFormatPanelProps,
  "bold" | "italic" | "underline" | "strike" | "fontFamily" | "fontSizePt" | "textColor" | "align" | "bullet" | "lineSpacingPct"
>;

/** What the selection-driven panels read: the anchor (first selected id) and the
 *  typed anchors derived from the rendition node types. */
export interface PptxPanelSelection {
  elementId: string | null;
  elementType: string | null;
  ids: readonly string[];
  tableId: string | null;
  chartId: string | null;
  pictureId: string | null;
  /** Selected ids that take text formatting, anchor first (W9 review F6). */
  textIds?: readonly string[];
  textFormat?: PptxTextFormatSeed;
}

/** Derive the panel selection from the rendition boxes and the selected ids. */
export function pptxPanelSelection(boxes: readonly PptxNodeBox[], ids: readonly string[]): PptxPanelSelection {
  const elementId = ids[0] ?? null;
  const elementType = elementId === null ? null : (boxes.find((box) => box.sourceId === elementId)?.type ?? null);
  return {
    elementId,
    elementType,
    ids,
    tableId: elementType === "table" ? elementId : null,
    chartId: elementType === "chart" ? elementId : null,
    pictureId: elementType === "picture" ? elementId : null,
  };
}

/** The contextual ribbon tab -> panel mapping; null for any other tab. */
export function pptxPanelForContextualTab(tabId: string): PptxPanelKind | null {
  switch (tabId) {
    case "context-shape":
    case "context-picture": return "format";
    case "context-table": return "tables";
    case "context-chart": return "charts";
    default: return null;
  }
}

/**
 * The fixed ribbon tab -> panel mapping. A contextual panel (Tables, Charts,
 * Format) is chosen by the selection, not the tab, so it has no tab entry here;
 * the caller passes it through `panel` directly.
 */
export function pptxPanelForTab(tab: PptxTabId | string): PptxPanelKind | null {
  switch (tab) {
    case "design": return "design";
    case "insert": return "insert";
    case "animations": return "animations";
    case "transitions": return "transitions";
    case "review": return "notes";
    case "view": return "sorter";
    default: return null;
  }
}

export interface PptxPanelHostProps {
  panel: PptxPanelKind;
  /** One committed edit per call (a registered PptxEdit kind, or a committed
   *  panel union the engine has not registered yet); absent leaves the panel
   *  honestly disabled. */
  onApplyEdit?: (edit: PptxPanelEdit) => Promise<unknown>;
  /** One gesture's edits in one call (W9 review F2); the text-format panel uses it. */
  onApplyEdits?: (edits: readonly PptxPanelEdit[]) => Promise<unknown>;
  /** Bulk edit channel (the editor handle's `edit`), used by the sorter. */
  onEdit?: (edits: readonly PptxEdit[]) => Promise<unknown>;
  onError?: (error: unknown) => void;
  slideIndex?: number | null;
  slideCount?: number;
  slides?: readonly PptxSlideView[];
  /** Deck data for the notes/comments/headerfooter/media panels. */
  data?: PptxPanelData;
  /** The live canvas selection; selection-driven panels remount when it changes. */
  selection?: PptxPanelSelection;
  /** Sorter ports (W4 F-13/F-03): a tile click selects that slide in the
   *  editor; the layout list feeds "New slide". Absent keeps them inert. */
  onSelectSlide?: (index: number) => void;
  loadLayouts?: () => Promise<readonly PptxSorterLayout[]>;
  className?: string;
}

export function PptxPanelHost({
  panel,
  onApplyEdit,
  onApplyEdits,
  onEdit,
  onSelectSlide,
  loadLayouts,
  onError,
  slideIndex = null,
  slideCount = 0,
  slides = [],
  data = {},
  selection,
  className,
}: PptxPanelHostProps) {
  // W5 review F14: element ids repeat across slides, so the slide is part of the key.
  const selectionKey = `${slideIndex ?? "none"}:${selection?.elementId ?? "none"}`;
  switch (panel) {
    case "design":
      return <PptxDesignPanel {...(onApplyEdit ? { onApplyEdit: (edit) => onApplyEdit(edit) } : {})} {...(onError ? { onError } : {})} slideCount={slideCount} slideIndex={slideIndex} className={className} />;
    case "insert":
      return (
        <PptxInsertPanel
          slideIndex={slideIndex}
          {...(data.insertElements ? { elements: data.insertElements } : {})}
          {...(selection ? { selectedIds: selection.ids, pictureId: selection.pictureId } : {})}
          {...(onApplyEdit ? { onEdit: (edit) => onApplyEdit(edit) } : {})}
          className={className}
        />
      );
    case "animations":
      return (
        <PptxAnimationsPanel
          slideIndex={slideIndex}
          entries={data.animations ?? []}
          {...(selection ? { targetElementId: selection.elementId } : {})}
          {...(onApplyEdit
            ? {
                onAdd: (entry: PptxAnimationEntry, elementId: string) =>
                  void onApplyEdit({ op: "add_animation", slideIndex: slideIndex ?? 0, elementId, effect: entry.effect, trigger: entry.trigger, durationMs: entry.durationMs, delayMs: entry.delayMs }),
                onRemove: (index: number) => void onApplyEdit({ op: "remove_animation", slideIndex: slideIndex ?? 0, seq: index }),
                onReorder: (from: number, to: number) => void onApplyEdit({ op: "reorder_animation", slideIndex: slideIndex ?? 0, seq: from, to }),
              }
            : {})}
          className={className}
        />
      );
    case "transitions":
      return (
        <PptxTransitionsPanel
          slideIndex={slideIndex}
          {...(data.transition ? { currentKind: data.transition.kind, advanceMs: data.transition.advanceMs } : {})}
          {...(onApplyEdit
            ? {
                // "Apply to all" is one gesture over every slide: one history entry when the bulk port is bound
                // (usePptxPanels always binds it next to the single port). A caller that passes only onApplyEdit
                // gets the edits in order, one awaited call each - one history entry apiece, never concurrent.
                onApplyTransition: (kind, allSlides) => {
                  const targets = allSlides && slideCount > 0 ? Array.from({ length: slideCount }, (_, index) => index) : [slideIndex ?? 0];
                  const edits = targets.map((index): PptxPanelEdit => ({ op: "set_transition", slideIndex: index, kind }));
                  void (onApplyEdits && edits.length > 1
                    ? onApplyEdits(edits)
                    : (async () => {
                        for (const edit of edits) await onApplyEdit(edit);
                      })());
                },
                onApplyAdvance: (ms) => void onApplyEdit({ op: "set_advance_time", slideIndex: slideIndex ?? 0, ms }),
              }
            : {})}
          className={className}
        />
      );
    case "sorter":
      return <PptxSorterPanel slides={slides} selectedIndex={slideIndex ?? 0} {...(onEdit ? { onEdit } : {})} {...(onSelectSlide ? { onSelectSlide } : {})} {...(loadLayouts ? { loadLayouts } : {})} className={className} />;
    case "tables":
      return <PptxTablesPanel key={selectionKey} {...(selection ? { tableElementId: selection.tableId } : {})} {...(onApplyEdit ? { onApplyEdit: (edit) => onApplyEdit(edit) } : {})} {...(onError ? { onError } : {})} slideCount={slideCount} slideIndex={slideIndex} className={className} />;
    case "charts":
      return <PptxChartsPanel key={selectionKey} {...(selection ? { chartElementId: selection.chartId } : {})} {...(onApplyEdit ? { onApplyEdit: (edit) => onApplyEdit(edit) } : {})} {...(onError ? { onError } : {})} slideCount={slideCount} slideIndex={slideIndex} className={className} />;
    case "format":
      return <PptxFormatPanel key={selectionKey} {...(selection ? { selectedElementId: selection.elementId, selectedElementType: selection.elementType, selectedIds: selection.ids } : {})} {...(onApplyEdit ? { onApplyEdit: (edit) => onApplyEdit(edit) } : {})} {...(onError ? { onError } : {})} slideIndex={slideIndex} className={className} />;
    case "text-format":
      return (
        <PptxTextFormatPanel
          key={selectionKey}
          {...(selection ? { selectedElementId: selection.elementId, selectedElementType: selection.elementType, ...(selection.textIds ? { targetIds: selection.textIds } : {}), ...selection.textFormat } : {})}
          {...(onApplyEdit ? { onApplyEdit: (edit) => onApplyEdit(edit) } : {})}
          {...(onApplyEdits ? { onApplyEdits: (edits) => onApplyEdits(edits) } : {})}
          {...(onError ? { onError } : {})}
          slideIndex={slideIndex}
          className={className}
        />
      );
    case "links":
      return <PptxLinkEditor key={selectionKey} {...(selection ? { elementId: selection.ids.length === 1 ? selection.elementId : null } : {})} slideIndex={slideIndex} {...(onApplyEdit ? { onSetLink: (edit) => onApplyEdit(edit) } : {})} {...(onError ? { onError } : {})} slideCount={slideCount} className={className} />;
    case "notes":
      return (
        <PptxNotesPane
          slideIndex={slideIndex}
          notes={data.notes ?? null}
          {...(data.notesLoading !== undefined ? { loading: data.notesLoading } : {})}
          {...(onApplyEdit
            ? (data.readonly !== undefined ? { readonly: data.readonly } : {})
            : // W9 review F3: without an edit channel the notes stay readable, never writable.
              { readonly: true })}
          {...(onApplyEdit
            ? { onCommitNotes: (index: number, text: string) => void onApplyEdit({ op: "set_notes", slideIndex: index, text }) }
            : {})}
          className={className}
        />
      );
    case "comments":
      return (
        <PptxCommentsPanel
          slideIndex={slideIndex}
          comments={data.comments ?? []}
          {...(data.commentsLoading !== undefined ? { loading: data.commentsLoading } : {})}
          {...(data.defaultAuthor !== undefined ? { defaultAuthor: data.defaultAuthor } : {})}
          {...(data.readonly !== undefined ? { readonly: data.readonly } : {})}
          {...(onApplyEdit
            ? {}
            : // W5 review F3: without an edit channel the comments stay readable;
              // only the writing controls give way to the reason.
              { readonly: true, readonlyReasonKey: "reasons.edit_unbound" })}
          {...(onApplyEdit
            ? {
                onAddComment: (index: number, text: string, author: string) =>
                  void onApplyEdit({ op: "add_comment", slideIndex: index, text, author }),
                onDeleteComment: (index: number, authorId: number, idx: number) =>
                  void onApplyEdit({ op: "delete_comment", slideIndex: index, authorId, idx }),
              }
            : {})}
          className={className}
        />
      );
    case "headerfooter":
      return (
        <PptxHeaderFooterPanel
          slideCount={slideCount}
          {...(data.headerFooterSettings !== undefined ? { settings: data.headerFooterSettings } : {})}
          {...(data.headerFooterLoading !== undefined ? { loading: data.headerFooterLoading } : {})}
          {...(data.readonly !== undefined ? { disabled: data.readonly } : {})}
          {...(onApplyEdit ? { onApplyEdit: (edit) => onApplyEdit(edit) } : {})}
          {...(onError ? { onError } : {})}
          className={className}
        />
      );
    case "media":
      return (
        <PptxMediaPanel
          slideCount={slideCount}
          slideIndex={slideIndex}
          {...(data.mediaElementId !== undefined ? { mediaElementId: data.mediaElementId } : {})}
          {...(data.readonly !== undefined ? { disabled: data.readonly } : {})}
          {...(onApplyEdit ? { onSelect: (edit) => onApplyEdit(edit) } : {})}
          {...(onError ? { onError } : {})}
          className={className}
        />
      );
    default:
      return null;
  }
}

/** Right-hand aside the editor mounts the active panel in. Renders nothing when
 * no panel is supplied, so an editor with no side surface keeps its layout. */
export function PptxPanelAside({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <aside
      data-pptx-panel-host
      data-pptx-panel-placement="aside"
      className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-background lg:flex"
    >
      {children}
    </aside>
  );
}

/** Where a panel mounts in the Office frame: notes under the canvas, the rest in the aside. */
export function pptxPanelPlacement(kind: PptxPanelKind): "aside" | "bottom" {
  return kind === "notes" ? "bottom" : "aside";
}

/** Bottom strip (frame `bottom` slot) for panels that live under the canvas. */
export function PptxPanelBottom({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <section
      data-pptx-panel-host
      data-pptx-panel-placement="bottom"
      className="flex max-h-48 min-h-24 shrink-0 flex-col overflow-y-auto border-t border-border bg-background"
    >
      {children}
    </section>
  );
}

export interface PptxPanelNodeOptions {
  panelKind?: PptxPanelKind;
  onApplyEdit?: (edit: PptxPanelEdit) => Promise<unknown>;
  /** One gesture's edits in one call; defaults to the handle edit port. */
  onApplyEdits?: (edits: readonly PptxPanelEdit[]) => Promise<unknown>;
  /** The editor handle edit port; used when the host binds no onApplyEdit. */
  edit?: (edits: readonly PptxEdit[]) => Promise<unknown>;
  onError?: (error: unknown) => void;
  slideIndex?: number;
  slides?: readonly PptxSlideView[];
  data?: PptxPanelData;
  selection?: PptxPanelSelection;
  /** Sorter ports (W4 F-13/F-03): a tile click selects that slide in the
   *  editor; the layout list feeds "New slide". Absent keeps them inert. */
  onSelectSlide?: (index: number) => void;
  loadLayouts?: () => Promise<readonly PptxSorterLayout[]>;
  /** Wrapper to use; defaults to the aside. Callers pass `pptxPanelPlacement(kind)`. */
  placement?: "aside" | "bottom";
}

/** Compose the active panel node (with its aside wrapper) or null. Pure: the
 *  caller passes every port; a missing port leaves the panel honestly disabled. */
export function buildPptxPanel(options: PptxPanelNodeOptions): ReactNode {
  const { panelKind, onApplyEdit, onApplyEdits, edit, onError, slideIndex = 0, slides = [], data, selection, onSelectSlide, loadLayouts, placement } = options;
  const Wrapper = placement === "bottom" ? PptxPanelBottom : PptxPanelAside;
  if (!panelKind) return null;
  // The ONE cast of the whole seam: the engine has not registered every panel
  // union in `PptxEdit` yet (WIRE-KINDS owns that), so the committed edit is
  // handed to the same generic handle edit port every other kind uses.
  const applyEdit = onApplyEdit ?? (edit ? (one: PptxPanelEdit) => edit([one as PptxEdit]) : undefined);
  const applyEdits = onApplyEdits ?? (edit ? (list: readonly PptxPanelEdit[]) => edit(list as readonly PptxEdit[]) : undefined);
  return (
    <Wrapper>
      <PptxPanelHost
        panel={panelKind}
        {...(applyEdit ? { onApplyEdit: applyEdit } : {})}
        {...(applyEdits ? { onApplyEdits: applyEdits } : {})}
        {...(edit ? { onEdit: edit } : {})}
        {...(onError ? { onError } : {})}
        slideIndex={slideIndex}
        slideCount={slides.length}
        slides={slides}
        {...(data ? { data } : {})}
        {...(selection ? { selection } : {})}
        {...(onSelectSlide ? { onSelectSlide } : {})}
        {...(loadLayouts ? { loadLayouts } : {})}
      />
    </Wrapper>
  );
}
