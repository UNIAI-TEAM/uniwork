"use client";

// Wave A / A4 (UNI-926): the find & replace controller. Every read goes
// through the renderer host's bounded window; every write goes through the
// toolbar's one command port, so replacements journal and save exactly like
// typing and no second save path exists.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RendererRangeCell } from "../xlsx-render-model-bridge";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxToolbarCommands } from "../toolbar/types";
import type { XlsxSelection } from "../types";
import {
  buildFindReplacement,
  exceedsFindReplaceLimit,
  findMatches,
  normalizeFindQuery,
  type XlsxFindMatch,
  type XlsxFindReplacement,
} from "./find-match";
import { clipScanResult, findScanRange, type XlsxFindScope } from "./find-window";

/** Command ids, all already allowlisted in the renderer's command policy:
 *  `set-range-values` is the allowlisted cell-edit command (its mutation
 *  journals through the existing path), `select-range` and `scroll-to-cell`
 *  are the view commands that move the grid onto a match. The pinned Univer
 *  find/replace commands (`ui.command.replace-current-match` and friends)
 *  read their query from `IFindReplaceService` state that the toolbar port
 *  cannot set, so they are deliberately not used. */
export const XLSX_FIND_SET_VALUES_COMMAND = "sheet.command.set-range-values";
export const XLSX_FIND_SELECT_COMMAND = "sheet.command.select-range";
export const XLSX_FIND_SCROLL_COMMAND = "sheet.command.scroll-to-cell";

export type XlsxFindScanState =
  /** Nothing read yet (or the scope window holds no used cell). */
  | { kind: "empty" }
  | { kind: "loading" }
  /** No mounted sheet with that name (the grid is gone or renamed). */
  | { kind: "unavailable" }
  | { kind: "error" }
  | {
      kind: "ready";
      cells: readonly RendererRangeCell[];
      scannedRows: number;
      totalRows: number;
      partial: boolean;
    };

export type XlsxFindAction =
  | { kind: "idle" }
  | { kind: "replaced" }
  | { kind: "replacedAll"; count: number }
  | { kind: "limit"; count: number }
  | { kind: "failed" };

export interface XlsxFindReplaceOptions {
  documentKey: string;
  host: XlsxGridHostPort;
  commands: XlsxToolbarCommands;
  selection: XlsxSelection | null;
  /** The active sheet's name; the scan targets it. */
  sheetName: string | null;
  /** The editor's dirty generation: an applied edit re-reads the window. */
  dirtyGeneration?: number;
  readOnly?: boolean;
}

export interface XlsxFindController {
  query: string;
  changeQuery: (value: string) => void;
  replacement: string;
  changeReplacement: (value: string) => void;
  matchCase: boolean;
  changeMatchCase: (value: boolean) => void;
  scope: XlsxFindScope;
  changeScope: (value: XlsxFindScope) => void;
  scan: XlsxFindScanState;
  /** A read is in flight; a ready result stays visible until it settles. */
  pending: boolean;
  matches: readonly XlsxFindMatch[];
  matchCount: number;
  /** Matches a replace may write (formula cells are matched, never replaced). */
  replaceableCount: number;
  /** 0-based cursor into `matches`; -1 before the first find next/previous. */
  currentIndex: number;
  action: XlsxFindAction;
  queryActive: boolean;
  canFind: boolean;
  canReplace: boolean;
  canReplaceAll: boolean;
  findNext: () => void;
  findPrevious: () => void;
  replace: () => void;
  replaceAll: () => void;
}

const EMPTY_SCAN: XlsxFindScanState = { kind: "empty" };

/** The bounded read window plus the matched-cell index for one sheet/scope. */
export function useXlsxFindReplace({
  documentKey,
  host,
  commands,
  selection,
  sheetName,
  dirtyGeneration = 0,
  readOnly = false,
}: XlsxFindReplaceOptions): XlsxFindController {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [scope, setScope] = useState<XlsxFindScope>("selection");
  const [cursor, setCursor] = useState(-1);
  const [action, setAction] = useState<XlsxFindAction>({ kind: "idle" });
  const [scan, setScan] = useState<XlsxFindScanState>(EMPTY_SCAN);
  const [pending, setPending] = useState(false);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const tokenRef = useRef(0);

  const sheet = useMemo(
    () => (sheetName === null ? undefined : host.file.sheets.find((candidate) => candidate.name === sheetName)),
    [host, sheetName],
  );
  const selectionKey = selection === null
    ? null
    : `${selection.sheet}\u0000${selection.address}\u0000${selection.endAddress ?? ""}`;
  // A selection edit re-reads the window only while the selection is the
  // scope; the whole-sheet read does not depend on where the cursor sits.
  const scanKey = scope === "selection" ? selectionKey : "sheet";

  useEffect(() => {
    const token = ++tokenRef.current;
    if (!sheet) {
      setScan({ kind: "unavailable" });
      setPending(false);
      return undefined;
    }
    const request = findScanRange(scope, selectionRef.current, sheet);
    if (!request) {
      setScan(EMPTY_SCAN);
      setPending(false);
      return undefined;
    }
    setScan((previous) => (previous.kind === "ready" ? previous : { kind: "loading" }));
    setPending(true);
    void host
      .readRange({ sessionId: host.file.sessionId, sheetId: sheet.id, range: request.range })
      .then((result) => {
        if (tokenRef.current !== token) return;
        const clipped = clipScanResult(result, request);
        setScan({
          kind: "ready",
          cells: clipped.cells,
          scannedRows: clipped.scannedRows,
          totalRows: clipped.totalRows,
          partial: clipped.partial,
        });
        setPending(false);
      })
      .catch(() => {
        if (tokenRef.current !== token) return;
        setScan({ kind: "error" });
        setPending(false);
      });
    return () => {
      if (tokenRef.current === token) tokenRef.current += 1;
    };
  }, [documentKey, host, sheet, scope, scanKey, dirtyGeneration]);

  // A new query, replacement, case mode or scope invalidates the last action
  // message; the match list itself is derived below.
  useEffect(() => {
    setAction({ kind: "idle" });
  }, [query, replacement, matchCase, scope]);

  const matches = useMemo(
    () => (scan.kind === "ready" ? findMatches(scan.cells, query, matchCase) : []),
    [scan, query, matchCase],
  );
  const matchCount = matches.length;
  const replaceableCount = useMemo(
    () => matches.reduce((count, match) => count + (match.replaceable ? 1 : 0), 0),
    [matches],
  );
  const currentIndex = matchCount === 0 ? -1 : Math.min(Math.max(cursor, -1), matchCount - 1);
  const queryActive = normalizeFindQuery(query) !== null;
  const canFind = matchCount > 0;
  const canReplace = !readOnly && currentIndex >= 0 && matches[currentIndex]?.replaceable === true;
  const canReplaceAll = !readOnly && replaceableCount > 0;

  const execute = useCallback(
    (id: string, params: unknown): boolean => {
      try {
        return commands.execute(id, params);
      } catch {
        // A command id the pin does not know throws from the command service;
        // the panel reports a failed action instead of unmounting.
        return false;
      }
    },
    [commands],
  );

  const reveal = useCallback(
    (match: XlsxFindMatch) => {
      if (!sheet) return;
      const range = {
        startRow: match.row,
        endRow: match.row,
        startColumn: match.column,
        endColumn: match.column,
      };
      execute(XLSX_FIND_SELECT_COMMAND, {
        unitId: `file-${host.file.sha256}`,
        subUnit: sheet.id,
        range,
      });
      execute(XLSX_FIND_SCROLL_COMMAND, { range });
    },
    [execute, host, sheet],
  );

  const findNext = useCallback(() => {
    if (matchCount === 0) return;
    const next = currentIndex < 0 ? 0 : (currentIndex + 1) % matchCount;
    setCursor(next);
    setAction({ kind: "idle" });
    reveal(matches[next]!);
  }, [currentIndex, matchCount, matches, reveal]);

  const findPrevious = useCallback(() => {
    if (matchCount === 0) return;
    const previous = currentIndex < 0 ? matchCount - 1 : (currentIndex - 1 + matchCount) % matchCount;
    setCursor(previous);
    setAction({ kind: "idle" });
    reveal(matches[previous]!);
  }, [currentIndex, matchCount, matches, reveal]);

  const applyBatch = useCallback(
    (batch: XlsxFindReplacement): boolean => {
      if (!sheet || batch.count === 0) return true;
      return execute(XLSX_FIND_SET_VALUES_COMMAND, {
        unitId: `file-${host.file.sha256}`,
        subUnitId: sheet.id,
        value: batch.value,
      });
    },
    [execute, host, sheet],
  );

  const replace = useCallback(() => {
    if (!canReplace) return;
    const match = matches[currentIndex];
    if (!match) return;
    // The cursor keeps its index: the replaced cell usually stops matching, so
    // the same index is the next match once the re-read settles.
    const applied = applyBatch(buildFindReplacement([match], query, replacement, matchCase));
    setAction(applied ? { kind: "replaced" } : { kind: "failed" });
  }, [applyBatch, canReplace, currentIndex, matchCase, matches, query, replacement]);

  const replaceAll = useCallback(() => {
    if (!canReplaceAll) return;
    const batch = buildFindReplacement(matches, query, replacement, matchCase);
    if (exceedsFindReplaceLimit(batch.count)) {
      // The engine's per-job op bound: refuse, never send a truncated batch.
      setAction({ kind: "limit", count: batch.count });
      return;
    }
    const applied = applyBatch(batch);
    setAction(applied ? { kind: "replacedAll", count: batch.count } : { kind: "failed" });
  }, [applyBatch, canReplaceAll, matchCase, matches, query, replacement]);

  return {
    query,
    changeQuery: setQuery,
    replacement,
    changeReplacement: setReplacement,
    matchCase,
    changeMatchCase: setMatchCase,
    scope,
    changeScope: setScope,
    scan,
    pending,
    matches,
    matchCount,
    replaceableCount,
    currentIndex,
    action,
    queryActive,
    canFind,
    canReplace,
    canReplaceAll,
    findNext,
    findPrevious,
    replace,
    replaceAll,
  };
}
