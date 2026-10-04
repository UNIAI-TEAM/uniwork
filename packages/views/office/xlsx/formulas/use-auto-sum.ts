"use client";

// Wave A / A8 (UNI-926): the AutoSum controller. One bounded read of the
// guess window through the renderer host, one pure range decision, one write
// through the toolbar's allowlisted cell-edit command - so the inserted
// formula journals and saves exactly like typing one. Nothing is ever written
// when the guess finds no numeric block.

import { useCallback, useState } from "react";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxToolbarCommands } from "../toolbar/types";
import type { XlsxSelection } from "../types";
import {
  autoSumReadWindow,
  buildAutoSumCommand,
  buildAutoSumRange,
  type XlsxAutoSumRange,
} from "./autosum";

export interface XlsxAutoSumOptions {
  /** Present only with a mounted grid; without it AutoSum cannot read. */
  host?: XlsxGridHostPort;
  commands?: XlsxToolbarCommands;
  selection: XlsxSelection | null;
  /** The active sheet's name (the read targets it). */
  sheetName: string | null;
  /** Live-name -> live-id resolver (the editor's grid lookup). */
  resolveSheetId?: (liveName: string) => string | undefined;
  /** `file-<sha256>` of the mounted workbook. */
  unitId: string | null;
  /** Hints/reads are off while the grid is still mounting. */
  enabled?: boolean;
  readOnly?: boolean;
}

export interface XlsxAutoSumController {
  /** The button may run (grid mounted, editable, a selection). */
  canAutoSum: boolean;
  /** A read is in flight. */
  busy: boolean;
  /** The last attempt found no numeric block (nothing was written). */
  empty: boolean;
  /** The last attempt's command was refused (read-only flip, policy). */
  failed: boolean;
  /** The range the last successful press summed; for tests/reporting. */
  lastRange: XlsxAutoSumRange | null;
  autoSum: () => void;
}

/**
 * Reads the selection's guess window, decides the SUM range and writes it.
 * The read is the same main-thread host the status bar and find use; the write
 * is `sheet.command.set-range-values`, which the pinned command journals
 * through the existing envelope -> set_cell path.
 */
export function useXlsxAutoSum({
  host,
  commands,
  selection,
  sheetName,
  resolveSheetId,
  unitId,
  enabled = true,
  readOnly = false,
}: XlsxAutoSumOptions): XlsxAutoSumController {
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lastRange, setLastRange] = useState<XlsxAutoSumRange | null>(null);

  const sheet = (() => {
    if (sheetName === null || host === undefined) return undefined;
    if (resolveSheetId) {
      const id = resolveSheetId(sheetName);
      return id === undefined ? undefined : host.file.sheets.find((candidate) => candidate.id === id);
    }
    return host.file.sheets.find((candidate) => candidate.name === sheetName);
  })();

  const canAutoSum = enabled && !readOnly && host !== undefined && commands !== undefined && selection !== null && sheet !== undefined && unitId !== null;

  const autoSum = useCallback(() => {
    if (!canAutoSum || !host || !commands || !selection || !sheet || !sheetName || !unitId || busy) return;
    const window = autoSumReadWindow(selection);
    if (!window) {
      setEmpty(true);
      setFailed(false);
      return;
    }
    setBusy(true);
    setEmpty(false);
    setFailed(false);
    void host
      .readRange({ sessionId: host.file.sessionId, sheetId: sheet.id, range: window })
      .then((result) => {
        const range = buildAutoSumRange(result?.cells ?? [], selection);
        if (!range) {
          setLastRange(null);
          setEmpty(true);
          return;
        }
        setLastRange(range);
        // The formula text must use the LIVE sheet name (a session rename
        // changes it while the host file's id map keeps the old one); the id
        // still addresses the read/subUnitId.
        const command = buildAutoSumCommand(range, sheet.id, unitId, sheetName);
        let applied = false;
        try {
          applied = commands.execute(command.id, command.params);
        } catch {
          applied = false;
        }
        setFailed(!applied);
      })
      .catch(() => {
        setLastRange(null);
        setFailed(true);
      })
      .finally(() => setBusy(false));
  }, [busy, canAutoSum, commands, host, selection, sheet, sheetName, unitId]);

  return { canAutoSum, busy, empty, failed, lastRange, autoSum };
}
