"use client";

import { useEffect, useRef, useState } from "react";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxSelection } from "../types";
import { summarizeRead, summaryReadRequest, type XlsxSelectionSummary } from "./selection-summary";

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
 * Reads the current selection through the renderer host. Reads are keyed by
 * document + selection + the editor's dirty generation: a reply that belongs
 * to a selection that has since changed is dropped, an in-place edit under an
 * unchanged selection re-reads, and the host's own partial-indexing signals
 * ride along as `partial` so totals are never presented as covering the whole
 * selection.
 */
export function useXlsxSelectionSummary({
  documentKey,
  host,
  selection,
  dirtyGeneration = 0,
}: {
  documentKey: string;
  host?: XlsxGridHostPort;
  selection: XlsxSelection | null;
  /** The editor's dirty generation; a new value re-reads the current selection. */
  dirtyGeneration?: number;
}): XlsxSummaryController {
  const [state, setState] = useState<XlsxSummaryState>(() => initialState(selection, host));
  const [pending, setPending] = useState(false);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const tokenRef = useRef(0);
  const selectionKey = selection === null
    ? null
    : `${documentKey}\u0000${selection.sheet}\u0000${selection.address}\u0000${selection.endAddress ?? ""}`;

  useEffect(() => {
    const token = ++tokenRef.current;
    const current = selectionRef.current;
    if (!current) {
      setState({ kind: "empty" });
      setPending(false);
      return undefined;
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
  }, [documentKey, host, selectionKey, dirtyGeneration]);

  return { state, pending };
}
