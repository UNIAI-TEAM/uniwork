"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDocument,
  createDocumentFile,
  getDocument,
  getDocumentDownloadMeta,
  patchDocument,
  uploadDocumentAsset,
  uploadDocumentFile,
  type CreateDocumentBody,
  type CreateDocumentFileMeta,
  type PatchDocumentBody,
} from "../api/endpoints/documents";
import { DocumentNotVerifiableError, type Document } from "../types/document";
import { documentKeys } from "./keys";
import {
  createDocumentPatchTransport,
  DocumentSaveMachine,
  type DocumentSaveState,
  type PageDraft,
} from "./save-state";
import {
  requireVerifiableAsset,
  requireVerifiableDocument,
  requireVerifiableUpload,
} from "./verify";

// TanStack Query owns documents server state. Mutations return null when the
// response cannot prove the write; the guards in ./verify turn that into
// "result not verifiable" — the caller keeps its draft and idempotency key,
// and a malformed answer never reads as saved.

export function useDocument(wsId: string, documentId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: documentKeys.detail(wsId, documentId),
    queryFn: ({ signal }) => getDocument(documentId, signal),
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId,
  });
}

export function useCreateDocument(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateDocumentBody & { idempotencyKey?: string }) => {
      const { idempotencyKey, ...rest } = body;
      return requireVerifiableDocument(await createDocument(wsId, rest, { idempotencyKey }));
    },
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(wsId, doc.id), doc);
      // 05b lands list/tree hooks under this root; prefix-invalidate so they
      // pick the new document up without a reload.
      return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}

export function useCreateDocumentFile(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      file: Blob;
      meta?: CreateDocumentFileMeta;
      idempotencyKey?: string;
    }) => {
      const doc = await createDocumentFile(wsId, input.file, input.meta, {
        idempotencyKey: input.idempotencyKey,
      });
      const verified = requireVerifiableDocument(doc);
      if (!verified.file?.file_id) {
        // A file document without its FileService reference is not usable.
        throw new DocumentNotVerifiableError();
      }
      return verified;
    },
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(wsId, doc.id), doc);
      return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}

/**
 * PATCH the working copy — title/icon/visibility and ad-hoc content edits.
 * The autosave path for continuous page typing is useDocumentSave below,
 * which adds the 2 s debounce and the one-flight-per-document rule.
 */
export function useUpdateDocument(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { patch: PatchDocumentBody; idempotencyKey?: string }) =>
      requireVerifiableDocument(
        await patchDocument(documentId, input.patch, { idempotencyKey: input.idempotencyKey }),
      ),
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(wsId, documentId), doc);
      return doc;
    },
  });
}

/** Stage the bytes of a candidate file version (POST .../uploads). The claim
 *  this returns goes to useCommitDocumentVersion; nothing about the document
 *  has changed yet, so no document cache entry is touched on success. */
export function useUploadDocumentFile(wsId: string, documentId: string) {
  void wsId;
  return useMutation({
    mutationFn: async (input: { file: Blob; idempotencyKey?: string }) =>
      requireVerifiableUpload(
        await uploadDocumentFile(documentId, input.file, { idempotencyKey: input.idempotencyKey }),
      ),
  });
}

/** Upload an image the page embeds via asset://{id}. */
export function useUploadDocumentAsset(wsId: string, documentId: string) {
  void wsId;
  return useMutation({
    mutationFn: async (input: { file: Blob; idempotencyKey?: string }) =>
      requireVerifiableAsset(
        await uploadDocumentAsset(documentId, input.file, { idempotencyKey: input.idempotencyKey }),
      ),
  });
}

/** The download descriptor (file_id, checksum, disposition) of the live or a
 *  pinned file version — what the byte route would serve, without the bytes. */
export function useDocumentDownloadMeta(wsId: string, documentId: string, version?: number) {
  return useQuery({
    queryKey: documentKeys.downloadMeta(wsId, documentId, version),
    queryFn: ({ signal }) => getDocumentDownloadMeta(documentId, version, signal),
    enabled: !!wsId && !!documentId,
  });
}

/**
 * The page autosave loop as a hook: one DocumentSaveMachine per document,
 * PATCH transport through patchDocument, the acknowledged document written
 * back into the detail query on every save. The machine is a ref — it must
 * not re-render on every keystroke — so the hook subscribes and hands out the
 * snapshot for useSyncExternalStore.
 */
export function useDocumentSave(wsId: string, documentId: string, initialRevision: string) {
  const qc = useQueryClient();
  const machine = useMemo(
    () =>
      new DocumentSaveMachine({
        documentId,
        initialRevision,
        transport: createDocumentPatchTransport(patchDocument),
      }),
    // One machine per document: a revision prop change means the caller
    // re-fetched (fresh mount), not that the live machine should rebase —
    // updateBase handles in-place base moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wsId, documentId],
  );

  useEffect(() => () => machine.dispose(), [machine]);

  const state = useSyncExternalStore(machine.subscribe.bind(machine), machine.getState.bind(machine));

  useEffect(() => {
    if (state.phase === "saved" && state.acked) {
      qc.setQueryData(documentKeys.detail(wsId, documentId), state.acked);
    }
  }, [qc, wsId, documentId, state.phase, state.acked]);

  return useMemo(
    () => ({
      state: state as DocumentSaveState,
      edit: (draft: PageDraft) => machine.edit(draft),
      flush: () => machine.flush(),
      retry: () => machine.retry(),
      discardDraft: () => machine.discardDraft(),
      conflictResolved: (revision: string, acked?: Document | null) =>
        machine.conflictResolved(revision, acked),
      updateBase: (revision: string, acked?: Document | null) => machine.updateBase(revision, acked),
    }),
    [machine, state],
  );
}
