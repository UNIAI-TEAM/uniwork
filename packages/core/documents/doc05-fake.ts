// FAKE until DOC-05 (b) lands: swap for the real `admin_scope` field of the
// client document schema and the real admin-summary hook (UNI-1413/1628).
// Written by W-DOC06 (UNI-1630); every caller imports from this one file so
// the swap is one import per caller.
"use client";
import { useQuery } from "@tanstack/react-query";
import { getDocumentAdminSummaryFake } from "../api/endpoints/documents-admin-summary-fake";
import { documentKeys } from "./keys";

/** The DOC-05 field the client schema does not carry yet. */
export interface DocumentAdminScopeFake {
  admin_scope?: boolean;
}

/**
 * Read `admin_scope` off any document-shaped value, leniently: only a real
 * `true` counts. The parsed `Document` strips unknown keys today, so this is
 * false on every live read until DOC-05 (b) adds the field to the schema.
 */
export function readAdminScopeFake(doc: object | null | undefined): boolean {
  return !!doc && (doc as { admin_scope?: unknown }).admin_scope === true;
}

/**
 * The admin-summary read behind the locked card's "Manage access" entry
 * (access addendum §2.5). Off by default; a refusal is a normal answer (the
 * caller is not an administrator), so it is never retried.
 */
export function useDocumentAdminSummaryFake(wsId: string, documentId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...documentKeys.detail(wsId, documentId), "admin-summary"] as const,
    queryFn: ({ signal }) => getDocumentAdminSummaryFake(documentId, signal),
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId,
    retry: false,
  });
}
