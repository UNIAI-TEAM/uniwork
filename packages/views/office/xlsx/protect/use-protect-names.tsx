"use client";

// B7 (UNI-926): the editor-side wiring for sheet protection and the name
// manager. Freeze panes already ride the existing set_page_setup op (C2), so
// this hook only adds the two new op kinds: set_sheet_protection and
// set_defined_names. It owns the dialog state and the edit calls; the pure
// form model lives in ./protect-names-form.

import { useCallback, useState, type ReactNode } from "react";
import type { XlsxDefinedNameEntry } from "@uniwork/office-engine/xlsx";
import { XlsxProtectNamesDialog } from "./protect-names-dialog";

export interface XlsxProtectNamesOptions {
  activeSheet: string | null;
  readOnly: boolean;
  canEdit: boolean;
  edit?: ((ops: readonly unknown[]) => Promise<void> | void) | undefined;
  onApplied: () => void;
  onError: (message: string) => void;
}

export interface XlsxProtectNamesWiring {
  openProtect: () => void;
  setProtection: (protectedFlag: boolean) => void;
  applyNames: (names: readonly XlsxDefinedNameEntry[]) => void;
  dialog: ReactNode;
}

export function useXlsxProtectNames(options: XlsxProtectNamesOptions): XlsxProtectNamesWiring {
  const { activeSheet, readOnly, canEdit, edit, onApplied, onError } = options;
  const [open, setOpen] = useState(false);

  const run = useCallback((ops: readonly unknown[]) => {
    if (!canEdit || !edit) return;
    void Promise.resolve(edit(ops))
      .then(() => { onApplied(); })
      .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
  }, [canEdit, edit, onApplied, onError]);

  // One set_sheet_protection op the session model folds last-write-per-sheet;
  // the gateway adds or removes the worksheet <sheetProtection> element.
  const setProtection = useCallback((protectedFlag: boolean) => {
    if (!activeSheet) return;
    run([{ op: "set_sheet_protection", target: { sheet: activeSheet }, attributes: { protected: protectedFlag } }]);
  }, [activeSheet, run]);

  // One set_defined_names op; the gateway rewrites the workbook definedNames
  // section wholesale from this snapshot.
  const applyNames = useCallback((names: readonly XlsxDefinedNameEntry[]) => {
    run([{ op: "set_defined_names", attributes: { names: names.map((name) => ({ ...name })), preserveNames: [] } }]);
  }, [run]);

  const dialog = open
    ? <XlsxProtectNamesDialog readOnly={readOnly} onSetProtection={setProtection} onApplyNames={applyNames} onClose={() => setOpen(false)} />
    : null;

  return { openProtect: () => setOpen(true), setProtection, applyNames, dialog };
}
