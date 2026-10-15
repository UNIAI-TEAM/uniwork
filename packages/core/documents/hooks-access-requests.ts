"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createDocumentAccessRequest,
  type CreateDocumentAccessRequestBody,
} from "../api/endpoints/documents-access-requests";
import { ApiError, errorCode, errorFields } from "../api/http";
import { defaultStorage } from "../platform/storage";
import { DocumentNotVerifiableError } from "../types/document";
import { documentKeys } from "./keys";

/**
 * How one "request access" send ended, as the locked card shows it (access
 * addendum §3.4, F-13). `sent` and `already_pending` are answers, not errors:
 * the 409 means the requester's own earlier request is still waiting.
 */
export type AccessRequestOutcome =
  | { state: "sent" }
  | { state: "already_pending" }
  | { state: "cooldown"; retryAfterSeconds: number }
  | { state: "rate_limited" }
  | { state: "send_failed" };

/**
 * Read a refused send. 429 with `access_request_cooldown` carries the seconds
 * left in `fields.retry_after_seconds` (the Retry-After header as a fallback);
 * a 429 without that code is the 20-per-hour limiter. Anything else —
 * network, 5xx, an unverifiable answer — keeps the form for another try.
 */
export function accessRequestOutcome(err: unknown): AccessRequestOutcome {
  const code = errorCode(err);
  if (code === "access_request_pending") return { state: "already_pending" };
  if (err instanceof ApiError && err.status === 429) {
    if (code !== "access_request_cooldown") return { state: "rate_limited" };
    const field = errorFields(err)?.retry_after_seconds;
    const seconds = typeof field === "number" && Number.isFinite(field) ? field : err.retryAfterSeconds;
    return { state: "cooldown", retryAfterSeconds: Math.max(1, Math.ceil(seconds ?? 1)) };
  }
  return { state: "send_failed" };
}

// A display note only (§3.4): it never blocks the form. The server is the
// source of truth: a lost flag never lets a second request through (the 409
// sets it back), and a request that was handled or expired does not wait on it.
const SENT_FLAG_PREFIX = "uniwork_document_access_request_sent:";
const SENT_FLAG_TTL_MS = 24 * 60 * 60 * 1000;

function writeSentFlag(documentId: string): void {
  try {
    defaultStorage.setItem(SENT_FLAG_PREFIX + documentId, String(Date.now() + SENT_FLAG_TTL_MS));
  } catch {
    // Storage full or blocked: the 409 still restores the state next time.
  }
}

/** Whether this device sent a request for the document in the last 24 hours. */
export function readDocumentAccessRequestSent(documentId: string): boolean {
  let raw: string | null = null;
  try {
    raw = defaultStorage.getItem(SENT_FLAG_PREFIX + documentId);
  } catch {
    return false;
  }
  const until = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(until)) return false;
  if (until <= Date.now()) {
    clearDocumentAccessRequestSent(documentId);
    return false;
  }
  return true;
}

/** Drop the flag: the document loaded, or a decision on the request arrived (F-08). */
export function clearDocumentAccessRequestSent(documentId: string): void {
  try {
    defaultStorage.removeItem(SENT_FLAG_PREFIX + documentId);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/**
 * Ask the people who manage a document for access (W-DOC07). A permission
 * request, so it awaits the server (F-06). Resolves `sent` or
 * `already_pending` and marks the device flag; every other answer rejects,
 * and the caller reads it with `accessRequestOutcome`.
 */
export function useRequestDocumentAccess(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateDocumentAccessRequestBody): Promise<AccessRequestOutcome> => {
      let outcome: AccessRequestOutcome;
      try {
        const res = await createDocumentAccessRequest(documentId, body);
        if (!res || res.status !== "sent") throw new DocumentNotVerifiableError();
        outcome = { state: "sent" };
      } catch (err) {
        if (accessRequestOutcome(err).state !== "already_pending") throw err;
        outcome = { state: "already_pending" };
      }
      writeSentFlag(documentId);
      return outcome;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.accessRequests(wsId, documentId) }),
  });
}
