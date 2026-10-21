"use client";
import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getDocument } from "../api/endpoints/documents";
import {
  archiveDocument,
  moveDocument,
  purgeDocument,
  restoreDocument,
  shelveDocument,
  unshelveDocument,
} from "../api/endpoints/documents-collections";
import { createDownloadJob, getDownloadJob, type DocumentDownloadJob } from "../api/endpoints/documents-download-jobs";
import { DocumentNotVerifiableError } from "../types/document";
import { createSafeId } from "../utils";
import { runBulk, type BulkResult } from "./bulk";
import { documentKeys } from "./keys";
import { requireVerifiableArchive, requireVerifiableDocument } from "./verify";

// The bulk bar's commands (UNI-2045 W9). Each reuses the single-document
// endpoint the row menu's hook calls, but none of those hooks: they
// invalidate per call, and a batch invalidates the workspace document root
// once, after its last call settles.

export type BulkDocumentCommand = "move" | "shelve" | "unshelve" | "trash" | "restore" | "purge";

export interface BulkDocumentInput {
  command: BulkDocumentCommand;
  ids: readonly string[];
  /** Move only: the one target folder of the batch; null is the workspace root. */
  parentId?: string | null;
}

async function runOne(command: BulkDocumentCommand, id: string, idempotencyKey: string, parentId: string | null): Promise<void> {
  switch (command) {
    case "move": {
      // A move is sent on the revision the server has now, never a cached one.
      const current = await getDocument(id);
      if (!current?.id || !current.revision) throw new DocumentNotVerifiableError();
      requireVerifiableDocument(await moveDocument(id, { parent_id: parentId, revision: current.revision }, { idempotencyKey }));
      return;
    }
    case "shelve":
      requireVerifiableArchive(await shelveDocument(id, { idempotencyKey }));
      return;
    case "unshelve":
      requireVerifiableArchive(await unshelveDocument(id, { idempotencyKey }));
      return;
    case "trash":
      requireVerifiableArchive(await archiveDocument(id, { idempotencyKey }));
      return;
    case "restore":
      requireVerifiableArchive(await restoreDocument(id, { idempotencyKey }));
      return;
    case "purge":
      await purgeDocument(id);
      return;
    default:
      throw new Error(`unknown bulk command: ${String(command)}`);
  }
}

/** Runs one command over many documents; resolves `{ok, failed}` (it never rejects) and invalidates the lists once. */
export function useBulkDocumentCommand(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ command, ids, parentId = null }: BulkDocumentInput): Promise<BulkResult> => {
      // One key per document for the whole batch: the 429 retry replays the same write.
      const keys = new Map(ids.map((id) => [id, createSafeId()]));
      return runBulk(ids, (id) => runOne(command, id, keys.get(id)!, parentId));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) }),
  });
}

const TERMINAL = new Set<string>(["ready", "failed", "expired"]);

/**
 * Creates the SV-9 zip job and polls it every `pollMs` (2 s) until it is
 * ready, failed or expired, or `maxPolls` runs out; it answers the last job
 * it read (still `queued`/`running` past the cap). A job without an id is not
 * verifiable; a 422 `download_too_large` rejects as the ApiError it is. When
 * the screen that called it unmounts the poll stops and the call rejects with
 * an AbortError (`isAbortError`): no further read, and no ready link to open
 * from whatever page the person has moved to.
 */
export function useDocumentDownloadJob(wsId: string, opts: { pollMs?: number; maxPolls?: number } = {}) {
  const { pollMs = 2000, maxPolls = 90 } = opts;
  const leave = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    leave.current = controller;
    return () => controller.abort();
  }, []);
  return useMutation({
    mutationFn: async (ids: readonly string[]): Promise<DocumentDownloadJob> => {
      const signal = leave.current?.signal;
      const stopIfLeft = () => {
        if (signal?.aborted) throw new DOMException("The download was left", "AbortError");
      };
      let job = await createDownloadJob(wsId, ids);
      if (!job) throw new DocumentNotVerifiableError();
      for (let polls = 0; !TERMINAL.has(job.status) && polls < maxPolls; polls += 1) {
        stopIfLeft();
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        stopIfLeft();
        const next: DocumentDownloadJob | null = await getDownloadJob(wsId, job.id, signal);
        if (!next) throw new DocumentNotVerifiableError();
        job = next;
      }
      stopIfLeft();
      return job;
    },
  });
}

/** Whether an error is the stop of a left screen (the zip poll, or a request cancelled with it). */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
