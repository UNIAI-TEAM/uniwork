"use client";

// FIX-EDITOR-SPLIT (UNI-926): the open-failure helpers extracted verbatim from
// xlsx-editor.tsx so the shell keeps only its size budget, not the two
// one-line predicates. No behaviour change: same bodies, same call sites.

import { openFailureClassOf } from "../too-large-notice";
import type { XlsxOpenFailure, XlsxOpenOutcome } from "./types";

export function unexpectedFailure(documentId: string, error: unknown): XlsxOpenFailure {
  return {
    outcome: "failed",
    document_id: documentId,
    format: "xlsx",
    failure_class: openFailureClassOf(error),
    message: error instanceof Error ? error.message : String(error),
  };
}

export function isFailure(outcome: XlsxOpenOutcome): outcome is XlsxOpenFailure {
  return outcome.outcome === "failed";
}
