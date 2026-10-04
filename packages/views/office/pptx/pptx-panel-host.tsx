"use client";

/**
 * The PPTX side-panel host (UNI-927 wire round).
 *
 * One dumb switch from the editor's active surface to the self-contained panel
 * that belongs to it: Design -> PptxDesignPanel, Insert -> PptxInsertPanel,
 * Animations -> PptxAnimationsPanel, Transitions -> PptxTransitionsPanel,
 * Sorter -> PptxSorterPanel, Tables -> PptxTablesPanel, Charts -> PptxChartsPanel,
 * Format -> PptxFormatPanel, Find -> PptxFindReplacePanel, Links -> PptxLinkEditor.
 *
 * It owns no write path. Every panel port is passed in; when a port is absent the
 * panel renders its own honest disabled state. Panels with a per-edit port route
 * it to `onApplyEdit` (one PptxEdit per call), the sorter routes its bulk channel
 * to `onEdit` (the editor handle's `edit`), and nothing here touches the engine,
 * the transport or the save coordinator directly.
 */
import type { ReactNode } from "react";
import type { FormatEdit, PptxEdit } from "@uniwork/office-engine/pptx";
import type { PptxSlideView } from "./slide-rail";
import type { PptxAnimationEntry } from "./animations";
import { PptxAnimationsPanel } from "./animations";
import { PptxChartsPanel } from "./charts";
import { PptxDesignPanel } from "./design";
import { PptxFindReplacePanel } from "./find";
import { PptxFormatPanel } from "./format";
import { PptxInsertPanel } from "./insert";
import { PptxLinkEditor } from "./links";
import { PptxSorterPanel } from "./sorter";
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
  | "find"
  | "links";

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
    case "view": return "sorter";
    default: return null;
  }
}

export interface PptxPanelHostProps {
  panel: PptxPanelKind;
  /** One committed edit per call (a PptxEdit kind, or a FormatEdit the engine
   *  has not registered in the PptxEdit union yet); absent leaves the panel
   *  honestly disabled. */
  onApplyEdit?: (edit: PptxEdit | FormatEdit) => Promise<unknown>;
  /** Bulk edit channel (the editor handle's `edit`), used by the sorter. */
  onEdit?: (edits: readonly PptxEdit[]) => Promise<unknown>;
  onError?: (error: unknown) => void;
  slideIndex?: number | null;
  slideCount?: number;
  slides?: readonly PptxSlideView[];
  className?: string;
}

export function PptxPanelHost({
  panel,
  onApplyEdit,
  onEdit,
  onError,
  slideIndex = null,
  slideCount = 0,
  slides = [],
  className,
}: PptxPanelHostProps) {
  switch (panel) {
    case "design":
      return <PptxDesignPanel {...(onApplyEdit ? { onApplyEdit: (edit) => onApplyEdit(edit) } : {})} {...(onError ? { onError } : {})} slideCount={slideCount} slideIndex={slideIndex} className={className} />;
    case "insert":
      return <PptxInsertPanel slideIndex={slideIndex} {...(onApplyEdit ? { onEdit: (edit) => onApplyEdit(edit) } : {})} className={className} />;
    case "animations":
      return (
        <PptxAnimationsPanel
          slideIndex={slideIndex}
          entries={[]}
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
          {...(onApplyEdit
            ? {
                onApplyTransition: (kind, allSlides) => void onApplyEdit({ op: "set_transition", slideIndex: slideIndex ?? 0, kind }),
                onApplyAdvance: (ms) => void onApplyEdit({ op: "set_advance_time", slideIndex: slideIndex ?? 0, ms }),
              }
            : {})}
          className={className}
        />
      );
    case "sorter":
      return <PptxSorterPanel slides={slides} selectedIndex={slideIndex ?? 0} {...(onEdit ? { onEdit } : {})} className={className} />;
    case "tables":
      return <PptxTablesPanel {...(onApplyEdit ? { onApplyEdit: (edit) => onApplyEdit(edit) } : {})} {...(onError ? { onError } : {})} slideCount={slideCount} slideIndex={slideIndex} className={className} />;
    case "charts":
      return <PptxChartsPanel {...(onApplyEdit ? { onApplyEdit: (edit) => onApplyEdit(edit) } : {})} {...(onError ? { onError } : {})} slideCount={slideCount} slideIndex={slideIndex} className={className} />;
    case "format":
      return <PptxFormatPanel {...(onApplyEdit ? { onApplyEdit: (edit) => onApplyEdit(edit) } : {})} {...(onError ? { onError } : {})} slideIndex={slideIndex} className={className} />;
    case "find":
      return <PptxFindReplacePanel texts={[]} {...(onApplyEdit ? { onFindReplace: (edit) => onApplyEdit(edit) } : {})} {...(onError ? { onError } : {})} className={className} />;
    case "links":
      return <PptxLinkEditor slideIndex={slideIndex} {...(onApplyEdit ? { onSetLink: (edit) => onApplyEdit(edit) } : {})} {...(onError ? { onError } : {})} slideCount={slideCount} className={className} />;
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
      className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-background lg:flex"
    >
      {children}
    </aside>
  );
}

export interface PptxPanelNodeOptions {
  panelKind?: PptxPanelKind;
  onApplyEdit?: (edit: PptxEdit | FormatEdit) => Promise<unknown>;
  /** The editor handle edit port; used when the host binds no onApplyEdit. */
  edit?: (edits: readonly PptxEdit[]) => Promise<unknown>;
  onError?: (error: unknown) => void;
  slideIndex?: number;
  slides?: readonly PptxSlideView[];
}

/** Compose the active panel node (with its aside wrapper) or null. Pure: the
 *  caller passes every port; a missing port leaves the panel honestly disabled. */
export function buildPptxPanel(options: PptxPanelNodeOptions): ReactNode {
  const { panelKind, onApplyEdit, edit, onError, slideIndex = 0, slides = [] } = options;
  if (!panelKind) return null;
  const applyEdit = onApplyEdit ?? (edit ? (one: PptxEdit | FormatEdit) => edit([one as PptxEdit]) : undefined);
  return (
    <PptxPanelAside>
      <PptxPanelHost
        panel={panelKind}
        {...(applyEdit ? { onApplyEdit: applyEdit } : {})}
        {...(edit ? { onEdit: edit } : {})}
        {...(onError ? { onError } : {})}
        slideIndex={slideIndex}
        slideCount={slides.length}
        slides={slides}
      />
    </PptxPanelAside>
  );
}


