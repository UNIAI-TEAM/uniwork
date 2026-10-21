"use client";
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
