"use client";

// Wave A / A9 (UNI-926): the editor-side controller for the grid context menu.
// It owns the anchor point, the resolved menu state and the close/focus dance,
// so the editor keeps only a small mount (mirrors `use-page-setup`). The menu
// itself dispatches through the SAME commands port and editor callbacks the
// toolbar groups use - this hook adds no command or save path of its own.

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { selectionSortRange } from "../sort/sort-commands";
import { addressParts } from "../xlsx-editor-model";
import type { XlsxToolbarCommands } from "../toolbar/types";
import type { XlsxEditorPermissions, XlsxSelection } from "../types";
import { XlsxContextMenu } from "./context-menu";
import type { XlsxContextMenuCallback, XlsxContextMenuState } from "./menu-items";

/** Fold the host's clipboard capability into the permission flags, so the
 *  toolbar and the context menu disable Copy/Paste on exactly the same
 *  condition (a host without the clipboard write/read APIs). */
export function foldClipboardPermissions(
  permissions: XlsxEditorPermissions,
  clipboard: { writeText?: unknown; readText?: unknown } | undefined,
): XlsxEditorPermissions {
  return {
    ...permissions,
    canCopy: permissions.canCopy !== false && typeof clipboard?.writeText === "function",
    canPaste: permissions.canPaste !== false && typeof clipboard?.readText === "function",
  };
}

/** The editor-side inputs the context-menu hook needs. */
export interface XlsxContextMenuConfig {
  readOnly: boolean;
  selection: XlsxSelection | null;
  canFormat: boolean;
  commands?: XlsxToolbarCommands;
  permissions?: XlsxEditorPermissions;
  /** The editor can cut (clipboard write + the allowlisted clear command). */
  canCut: boolean;
  /** The editor can open the find & replace panel. */
  canFind: boolean;
  /** `file-<sha256>`; null without a mounted grid (then sort is disabled). */
  unitId: string | null;
  /** Live-name -> live-id resolver (a session rename keeps the id). */
  resolveSheetId: (sheetName: string) => string | undefined;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onFind: () => void;
}

export interface XlsxContextMenuController {
  /** The grid reports the right-click point and the element focus returns to. */
  open: (point: { x: number; y: number }, container: HTMLElement) => void;
  close: () => void;
  /** The menu node, or null while closed. */
  node: ReactNode;
}

export function useXlsxContextMenu(config: XlsxContextMenuConfig): XlsxContextMenuController {
  const { readOnly, selection, canFormat, commands, permissions, canCut, canFind, unitId, resolveSheetId } = config;
  const { onCut, onCopy, onPaste, onFind } = config;
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  const open = useCallback((next: { x: number; y: number }, container: HTMLElement) => {
    containerRef.current = container;
    setPoint(next);
  }, []);
  const close = useCallback(() => setPoint(null), []);

  const state = useMemo<XlsxContextMenuState>(() => {
    const from = selection ? addressParts(selection.address) : null;
    const to = selection ? addressParts(selection.endAddress ?? selection.address) : null;
    const sheetId = selection ? resolveSheetId(selection.sheet) : undefined;
    const sort = unitId !== null && selection !== null && from !== null && to !== null && sheetId !== undefined
      ? { unitId, sheetId, range: selectionSortRange(from, to) }
      : null;
    return { readOnly, selection, canFormat, commands, permissions, canCut, canFind, sort };
  }, [canCut, canFind, canFormat, commands, permissions, readOnly, resolveSheetId, selection, unitId]);

  const onRunCallback = useCallback((callback: XlsxContextMenuCallback) => {
    if (callback === "cut") onCut();
    else if (callback === "copy") onCopy();
    else if (callback === "paste") onPaste();
    else onFind();
  }, [onCopy, onCut, onFind, onPaste]);

  const node = point === null ? null : (
    <XlsxContextMenu
      point={point}
      state={state}
      focusTarget={containerRef.current}
      onClose={close}
      onRunCallback={onRunCallback}
    />
  );

  return { open, close, node };
}