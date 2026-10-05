"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { findPdfTextHits } from "./search-model";
import type { PdfSearchHit, PdfTextDocument, PdfTextReader } from "./types";

export interface PdfSearchState {
  status: "idle" | "loading" | "ready" | "error";
  document: PdfTextDocument | null;
  query: string;
  hits: readonly PdfSearchHit[];
  activeIndex: number;
  activeHit: PdfSearchHit | null;
  error: unknown;
}

export interface UsePdfSearchOptions {
  bytes: Uint8Array | null;
  reader: PdfTextReader;
  enabled?: boolean;
}

export interface UsePdfSearchResult extends PdfSearchState {
  setQuery: (query: string) => void;
  next: () => PdfSearchHit | null;
  previous: () => PdfSearchHit | null;
  setActiveIndex: (index: number) => void;
  retry: () => void;
}

export function usePdfSearch({ bytes, reader, enabled = true }: UsePdfSearchOptions): UsePdfSearchResult {
  const [document, setDocument] = useState<PdfTextDocument | null>(null);
  const [status, setStatus] = useState<PdfSearchState["status"]>("idle");
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!enabled || !bytes) {
      setDocument(null);
      setStatus("idle");
      setError(null);
      return undefined;
    }
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    void reader(bytes).then((next) => {
      if (controller.signal.aborted) return;
      setDocument(next);
      setStatus("ready");
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setDocument(null);
      setStatus("error");
      setError(cause);
    });
    return () => controller.abort();
  }, [bytes, enabled, reader, retryToken]);

  const hits = useMemo(() => (document ? findPdfTextHits(document, query) : []), [document, query]);
  const boundedIndex = hits.length === 0 ? 0 : Math.min(activeIndex, hits.length - 1);
  const activeHit = hits[boundedIndex] ?? null;
  const updateQuery = useCallback((next: string) => {
    setQuery(next);
    setActiveIndex(0);
  }, []);
  const next = useCallback(() => {
    if (hits.length === 0) return null;
    const index = (boundedIndex + 1) % hits.length;
    setActiveIndex(index);
    return hits[index] ?? null;
  }, [boundedIndex, hits]);
  const previous = useCallback(() => {
    if (hits.length === 0) return null;
    const index = (boundedIndex - 1 + hits.length) % hits.length;
    setActiveIndex(index);
    return hits[index] ?? null;
  }, [boundedIndex, hits]);
  const retry = useCallback(() => setRetryToken((value) => value + 1), []);
  return { status, document, query, hits, activeIndex: boundedIndex, activeHit, error, setQuery: updateQuery, next, previous, setActiveIndex, retry };
}
