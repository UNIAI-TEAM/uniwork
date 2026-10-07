"use client";

import { useEffect, useRef, useState } from "react";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxSelection } from "../types";
import { isSingleCellSelection, summarizeRead, summarizeSelectionFromSnapshot, summaryReadRequest, type XlsxSelectionSummary } from "./selection-summary";

export type XlsxSummaryState =
  | { kind: "empty" }
  | { kind: "unavailable" }
  | { kind: "loading" }
  | { kind: "ready"; summary: XlsxSelectionSummary; partial: boolean }
  | { kind: "error" };

export interface XlsxSummaryController {
  state: XlsxSummaryState;
  /** A read is in flight; a ready summary stays visible until it settles. */
  pending: boolean;
}

function initialState(selection: XlsxSelection | null, host: XlsxGridHostPort | undefined): XlsxSummaryState {
  if (!selection) return { kind: "empty" };
  return host ? { kind: "loading" } : { kind: "unavailable" };
}

/**
 * Summarizes the current selection. Reads are keyed by document + selection +
 * the editor's dirty generation: a reply that belongs to a selection that has
 * since changed is dropped, an in-place edit under an unchanged selection
 * re-reads, and the host's own partial-indexing signals ride along as `partial`
 * so totals are never presented as covering the whole selection.
 *
 * F2 (UNI-926 FIX-STATUSBAR): when the editor supplies the live workbook
 * `snapshot`, the summary is computed from it instead of the renderer host.
 * The host's readRange serves the render model captured at open time, which an
 * edit or a sort never refreshes, so it reports pre-edit values and drops cells
 * the frozen model lacks. The snapshot is the editor's current values, so
 * edited cells and formula cells are counted.
 */
export function useXlsxSelectionSummary({
  documentKey,
  host,
  selection,
  dirtyGeneration = 0,
  snapshot = null,
}: {
  documentKey: string;
  host?: XlsxGridHostPort;
  selection: XlsxSelection | null;
  /** The editor's dirty generation; a new value re-reads the current selection. */
  dirtyGeneration?: number;
  /** F2: the live workbook snapshot; when present it is the read source. */
  snapshot?: XlsxWorkbookSnapshot | null;
}): XlsxSummaryController {
  const [state, setState] = useState<XlsxSummaryState>(() => initialState(selection, host));
  const [pending, setPending] = useState(false);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const tokenRef = useRef(0);
  const selectionKey = selection === null
    ? null
    : `${documentKey}\u0000${selection.sheet}\u0000${selection.address}\u0000${selection.endAddress ?? ""}\u0000${selection.merged === true}`;

  useEffect(() => {
    const token = ++tokenRef.current;
    const current = selectionRef.current;
    if (!current) {
      setState({ kind: "empty" });
      setPending(false);
      return undefined;
    }
    // F2: prefer the live workbook snapshot. The renderer host's readRange
    // serves the render model captured at open time and is never refreshed by
    // an edit, so reading through it reports pre-edit values. The snapshot
    // carries the current values (edited cells, formula cells).
    if (snapshot) {
      const live = summarizeSelectionFromSnapshot(snapshot, current);
      if (live) {
        setState({ kind: "ready", summary: live.summary, partial: live.partial });
        setPending(false);
        return undefined;
      }
    }
    const sheet = host?.file.sheets.find((candidate) => candidate.name === current.sheet);
    if (!host || !sheet) {
      setState({ kind: "unavailable" });
      setPending(false);
      return undefined;
    }
    const request = summaryReadRequest(current, sheet);
    if (!request) {
      setState({ kind: "empty" });
      setPending(false);
      return undefined;
    }
    // A single cell shows no statistics, so there is nothing to read.
    if (isSingleCellSelection(current)) {
      setState({ kind: "ready", summary: { kind: "empty" }, partial: false });
      setPending(false);
      return undefined;
    }
    setState((previous) => (previous.kind === "ready" ? previous : { kind: "loading" }));
    setPending(true);
    void host
      .readRange({ sessionId: host.file.sessionId, sheetId: sheet.id, range: request.range })
      .then((result) => {
        if (tokenRef.current !== token) return;
        const read = summarizeRead(result, request.range);
        setState({ kind: "ready", summary: read.summary, partial: read.partial || request.windowed });
        setPending(false);
      })
      .catch(() => {
        if (tokenRef.current !== token) return;
        setState({ kind: "error" });
        setPending(false);
      });
    return () => {
      if (tokenRef.current === token) tokenRef.current += 1;
    };
  }, [documentKey, host, selectionKey, dirtyGeneration, snapshot]);

  return { state, pending };
}