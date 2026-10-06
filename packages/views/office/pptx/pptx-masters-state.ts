"use client";

/**
 * Slide master panel state (B6 wire, UNI-927).
 *
 * Owns everything the View > Slide master panel needs and the editor does not:
 * the open toggle, the master/layout parts, the active part and its elements,
 * the selected element, the pending flag and the panel-edit -> engine-edit
 * mapping. The deck is read through two host functions (`masterParts` /
 * `masterElements`, threaded like `slideNotes`); an edit leaves through the same
 * generic edit channel every other panel uses. Without the read functions the
 * panel is honestly "unbound"; nothing is invented.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { EditorHandle } from "@uniwork/core/office";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import type { PptxCommandId } from "./command-map";
import type { MasterElementView, MasterPanelEdit, MasterPanelProps, MasterPartView } from "./masters";
import { toMasterEdit } from "./masters/masters-edit-map";
import { buildPptxPanel, resolvePanelApplyEdit, type PptxPanelEdit } from "./pptx-panel-host";

export interface PptxMastersOptions {
  masterParts?: () => readonly MasterPartView[];
  masterElements?: (partPath: string) => readonly MasterElementView[];
  /** The generic edit channel (host `onApplyEdit`, else the handle edit port). */
  applyEdit?: (edit: PptxPanelEdit) => Promise<unknown>;
  /** Changes whenever the deck is replaced (undo, redo, reload): re-reads the parts. */
  refreshKey?: unknown;
  onError?: (error: unknown) => void;
}

export interface PptxMastersState {
  open: boolean;
  /** Stable value for the toolbar `pressedCommands` (the Slide master toggle). */
  pressed: readonly PptxCommandId[];
  toggle: () => void;
  /** Props for `MastersPanel`; only meaningful while `open`. */
  panel: MasterPanelProps;
}

const PRESSED: readonly PptxCommandId[] = ["slideMaster"];
const NOT_PRESSED: readonly PptxCommandId[] = [];
const NO_PARTS: readonly MasterPartView[] = [];
const NO_ELEMENTS: readonly MasterElementView[] = [];

export function usePptxMasters({ masterParts, masterElements, applyEdit, refreshKey, onError }: PptxMastersOptions): PptxMastersState {
  const [open, setOpen] = useState(false);
  const [activePart, setActivePart] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // An applied edit re-reads the open part, so the panel shows what the engine holds.
  const [version, setVersion] = useState(0);
  // Hosts pass inline closures; reading them through a ref keeps the part parse
  // keyed on what actually changes (open, part, version, deck) and not on identity.
  const reads = useRef({ masterParts, masterElements, onError });
  reads.current = { masterParts, masterElements, onError };
  const bound = Boolean(masterParts && masterElements);

  const parts = useMemo(() => {
    if (!open) return NO_PARTS;
    try { return reads.current.masterParts?.() ?? NO_PARTS; } catch (error) { reads.current.onError?.(error); return NO_PARTS; }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version`/`refreshKey` are the re-read triggers
  }, [open, version, refreshKey]);
  const activeKnown = activePart !== null && parts.some((part) => part.partPath === activePart);
  const elements = useMemo(() => {
    if (!open || !activePart || !activeKnown) return NO_ELEMENTS;
    try { return reads.current.masterElements?.(activePart) ?? NO_ELEMENTS; } catch (error) { reads.current.onError?.(error); return NO_ELEMENTS; }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version`/`refreshKey` are the re-read triggers
  }, [open, activePart, activeKnown, version, refreshKey]);

  useEffect(() => {
    if (open && activePart && !activeKnown) setActivePart(null);
  }, [activeKnown, activePart, open]);
  useEffect(() => {
    if (selectedElementId !== null && !elements.some((element) => element.id === selectedElementId)) setSelectedElementId(null);
  }, [elements, selectedElementId]);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  const selectPart = useCallback((partPath: string) => { setActivePart(partPath); setSelectedElementId(null); }, []);
  const onEdit = useCallback(async (edit: MasterPanelEdit) => {
    if (!applyEdit) return;
    setPending(true);
    try {
      await applyEdit(toMasterEdit(edit));
    } catch (error) {
      reads.current.onError?.(error);
    } finally {
      setPending(false);
      setVersion((value) => value + 1);
    }
  }, [applyEdit]);

  const panel: MasterPanelProps = {
    parts,
    activePart: activeKnown ? activePart : null,
    onSelectPart: selectPart,
    elements,
    selectedElementId,
    onSelectElement: setSelectedElementId,
    ...(bound && applyEdit ? { onEdit } : {}),
    onClose: toggle,
    status: bound ? "ready" : "unbound",
    pending,
  };
  return { open, pressed: open ? PRESSED : NOT_PRESSED, toggle, panel };
}

/** The master reads a desktop editor handle carries (the web host passes props). */
interface MasterReadHandle {
  masterParts?(): readonly MasterPartView[];
  masterElements?(partPath: string): readonly MasterElementView[];
}

export interface PptxEditorMastersOptions {
  masterParts?: PptxMastersOptions["masterParts"];
  masterElements?: PptxMastersOptions["masterElements"];
  editorHandle: EditorHandle | null;
  onApplyEdit?: (edit: PptxPanelEdit) => Promise<unknown>;
  handleEdit?: (edits: readonly PptxEdit[]) => Promise<unknown>;
  refreshKey?: unknown;
  onError?: (error: unknown) => void;
}

/** The editor's View > Slide master wiring: host props win over the desktop
 *  handle's own readers (like the slide layouts), edits ride the one generic
 *  channel, and `aside` is the master view that replaces the tab panel while open. */
export function usePptxEditorMasters({ masterParts, masterElements, editorHandle, onApplyEdit, handleEdit, refreshKey, onError }: PptxEditorMastersOptions): PptxMastersState & { aside: ReactNode } {
  const handle = editorHandle as (EditorHandle & MasterReadHandle) | null;
  const partsReader = masterParts ?? handle?.masterParts?.bind(handle);
  const elementsReader = masterElements ?? handle?.masterElements?.bind(handle);
  const applyEdit = useMemo(() => resolvePanelApplyEdit(onApplyEdit, handleEdit), [handleEdit, onApplyEdit]);
  const state = usePptxMasters({
    ...(partsReader ? { masterParts: partsReader } : {}),
    ...(elementsReader ? { masterElements: elementsReader } : {}),
    ...(applyEdit ? { applyEdit } : {}),
    refreshKey,
    ...(onError ? { onError } : {}),
  });
  return { ...state, aside: state.open ? buildPptxPanel({ panelKind: "masters", masters: state.panel }) : null };
}
