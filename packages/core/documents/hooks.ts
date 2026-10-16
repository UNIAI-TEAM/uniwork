"use client";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDocument,
  createDocumentFile,
  downloadDocumentFile,
  ensureMyFolder,
  getDocument,
  getDocumentAsset,
  getDocumentDownloadMeta,
  patchDocument,
  uploadDocumentAsset,
  uploadDocumentFile,
  type CreateDocumentBody,
  type CreateDocumentFileMeta,
  type DocumentCreateDestination,
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
export { useDocumentLimits } from "./limits";

// TanStack Query owns documents server state. Mutations return null when the
// response cannot prove the write; the guards in ./verify turn that into
// "result not verifiable" — the caller keeps its draft and idempotency key,
// and a malformed answer never reads as saved.

export type CreateDocumentPlacementInput =
  | { parent_id?: string; parentId?: string; destination?: never }
  | { destination?: DocumentCreateDestination; parent_id?: never; parentId?: never };

export type CreateDocumentInput = Omit<CreateDocumentBody, "parent_id" | "destination"> & {
  idempotencyKey?: string;
} & CreateDocumentPlacementInput;

type CreateDocumentFileBase = { file: Blob; title?: string; idempotencyKey?: string };

// Placement is one choice across the whole input: the top level and `meta`
// must agree, so a destination never sits beside a parent at either level.
export type CreateDocumentFileInput =
  | (CreateDocumentFileBase & {
      parent_id?: string;
      parentId?: string;
      destination?: never;
      meta?: { title?: string; parent_id?: string; parentId?: string; destination?: never };
    })
  | (CreateDocumentFileBase & {
      destination?: DocumentCreateDestination;
      parent_id?: never;
      parentId?: never;
      meta?: { title?: string; destination?: DocumentCreateDestination; parent_id?: never; parentId?: never };
    });

export function useDocument(
  wsId: string,
  documentId: string,
  opts?: {
    enabled?: boolean;
    retry?: boolean | number | ((failureCount: number, error: unknown) => boolean);
  },
) {
  return useQuery({
    queryKey: documentKeys.detail(wsId, documentId),
    queryFn: ({ signal }) => getDocument(documentId, signal),
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId,
    ...(opts?.retry !== undefined ? { retry: opts.retry } : {}),
  });
}

export function useCreateDocument(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateDocumentInput) => {
      const { idempotencyKey, parentId, parent_id, destination, ...rest } = body;
      const resolvedParentId = parent_id ?? parentId;
      const payload: CreateDocumentBody =
        destination !== undefined
          ? { ...rest, destination }
          : { ...rest, ...(resolvedParentId !== undefined ? { parent_id: resolvedParentId } : {}) };
      return requireVerifiableDocument(await createDocument(wsId, payload, { idempotencyKey }));
    },
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(wsId, doc.id), doc);
      // 05b lands list/tree hooks under this root; prefix-invalidate so they
      // pick the new document up without a reload.
      return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}

/**
 * Ensure the caller's personal root folder ("My Folder") exists in this
 * workspace (MYFOLDER-01). Writes the verified folder into its detail cache
 * entry and invalidates the workspace root so tree/list pick it up.
 */
export function useEnsureMyFolder(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => requireVerifiableDocument(await ensureMyFolder(wsId)),
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(wsId, doc.id), doc);
      return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}

export function useCreateDocumentFile(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateDocumentFileInput) => {
      const parent_id = input.meta?.parent_id ?? input.meta?.parentId ?? input.parent_id ?? input.parentId;
      const destination = input.meta?.destination ?? input.destination;
      if (destination !== undefined && parent_id !== undefined) {
        // The types forbid this; refuse it at runtime too rather than drop the parent.
        throw new Error("createDocumentFile: destination and parent are mutually exclusive");
      }
      const title = input.meta?.title ?? input.title;
      const meta: CreateDocumentFileMeta | undefined =
        destination !== undefined
          ? { ...(title !== undefined ? { title } : {}), destination }
          : parent_id !== undefined || title !== undefined
            ? { ...(title !== undefined ? { title } : {}), ...(parent_id !== undefined ? { parent_id } : {}) }
            : input.meta;
      const doc = await createDocumentFile(wsId, input.file, meta, {
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
 * One page asset's bytes, for an `asset://{id}` a page embeds. The view turns
 * the blob into an object URL that lives as long as it is displayed; nothing
 * about the URL ever reaches the JSON, and the key sits outside the document
 * detail prefix so a realtime frame cannot refetch every image on the page.
 */
export function useDocumentAsset(wsId: string, documentId: string, assetId: string | null) {
  return useQuery({
    queryKey: assetId
      ? documentKeys.asset(wsId, documentId, assetId)
      : documentKeys.assetIdle(wsId, documentId),
    queryFn: ({ signal }) => getDocumentAsset(documentId, assetId!, signal),
    enabled: !!wsId && !!documentId && !!assetId,
    // Bytes behind one asset id never change; only the object URL is local.
    staleTime: Infinity,
  });
}

/**
 * The bytes of the live (or one pinned) file version, through the Go proxy.
 * The caller owns what to do with the blob — a browser download is a DOM
 * concern — but the transport call belongs here, with the other documents
 * reads, not in a view.
 */
export function useDocumentDownload(wsId: string, documentId: string) {
  return useMutation({
    mutationFn: ({ version }: { version?: number } = {}) =>
      downloadDocumentFile(documentId, version),
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
  // One machine per document: a revision prop change means the caller
  // re-fetched (fresh mount), not that the live machine should rebase —
  // updateBase handles in-place base moves.
  const makeMachine = useCallback(
    () =>
      new DocumentSaveMachine({
        documentId,
        initialRevision,
        transport: createDocumentPatchTransport(patchDocument),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wsId, documentId],
  );
  const [machine, setMachine] = useState(makeMachine);

  useEffect(() => {
    // React StrictMode mounts, cleans up and mounts again in development. The
    // cleanup disposed the machine this component still holds, and a disposed
    // machine ignores every later edit — autosave would be dead for the life
    // of the screen. Replace it instead of handing the editor a dead one.
    if (machine.isDisposed()) {
      setMachine(makeMachine());
      return;
    }
    return () => machine.dispose();
  }, [machine, makeMachine]);

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
