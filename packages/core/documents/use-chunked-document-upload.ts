"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { defaultStorage } from "../platform";
import { DocumentNotVerifiableError } from "../types/document";
import type { StorageAdapter } from "../types/storage";
import { createSafeId } from "../utils";
import {
  clearResumableUpload,
  findResumableUpload,
  startChunkedUpload,
  uploadFileKey,
  type ChunkedUpload,
  type ChunkedUploadPhase,
  type ChunkedUploadProgress,
  type ChunkedUploadResult,
  type ResumableUpload,
  type UploadSessionTarget,
} from "./chunked-upload";
import { documentKeys } from "./keys";
import { requireVerifiableDocument, requireVerifiableUpload } from "./verify";

interface UseChunkedDocumentUploadOptions {
  storage?: StorageAdapter;
  onProgress?: (p: ChunkedUploadProgress) => void;
  concurrency?: number;
  retryDelaysMs?: number[];
  fetch?: typeof fetch;
}

interface StartChunkedDocumentUploadInput {
  file: File | Blob;
  filename?: string;
  idempotencyKey?: string;
}

const ACTIVE_PHASES = new Set<ChunkedUploadPhase>([
  "probing",
  "opening",
  "uploading",
  "paused",
  "verifying",
]);

function resolveFilename(file: File | Blob, explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit;
  if ("name" in file && typeof file.name === "string" && file.name.length > 0) return file.name;
  return "blob";
}

/**
 * React hook wrapping `startChunkedUpload` with `StorageAdapter`, reactive
 * progress/phase state, `pause`/`resume`/`cancel` controls, and TanStack Query
 * cache updates on workspace-target completion (`contract-bigup-w1` §4).
 */
export function useChunkedDocumentUpload(
  target: UploadSessionTarget,
  opts?: UseChunkedDocumentUploadOptions,
) {
  const qc = useQueryClient();
  const storage = opts?.storage ?? defaultStorage;
  const activeRef = useRef<ChunkedUpload | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const onProgressRef = useRef(opts?.onProgress);
  onProgressRef.current = opts?.onProgress;

  const [progress, setProgress] = useState<ChunkedUploadProgress | null>(null);

  const findResumable = useCallback(
    (file: File | Blob, filename?: string): ResumableUpload | null => {
      const key = uploadFileKey(file, resolveFilename(file, filename));
      try {
        return findResumableUpload(storage, key, targetRef.current);
      } catch {
        return null;
      }
    },
    [storage],
  );

  const hasResumable = useCallback(
    (file: File | Blob, filename?: string): boolean => findResumable(file, filename) !== null,
    [findResumable],
  );

  const start = useCallback(
    async (input: StartChunkedDocumentUploadInput): Promise<ChunkedUploadResult> => {
      const currentTarget = targetRef.current;
      const filename = resolveFilename(input.file, input.filename);
      const saved = findResumable(input.file, filename);
      const idempotencyKey = saved?.idempotency_key ?? input.idempotencyKey ?? createSafeId();

      const upload = startChunkedUpload({
        file: input.file,
        filename,
        target: currentTarget,
        idempotencyKey,
        storage,
        concurrency: opts?.concurrency,
        retryDelaysMs: opts?.retryDelaysMs,
        fetch: opts?.fetch,
        onProgress: (p) => {
          setProgress(p);
          onProgressRef.current?.(p);
        },
      });
      activeRef.current = upload;

      try {
        const res = await upload.result;
        if (res.kind === "document") {
          const verified = requireVerifiableDocument(res.document);
          if (!verified.file?.file_id) {
            throw new DocumentNotVerifiableError();
          }
          if (currentTarget.kind === "workspace") {
            qc.setQueryData(documentKeys.detail(currentTarget.workspaceId, verified.id), verified);
            await qc.invalidateQueries({
              queryKey: documentKeys.workspace(currentTarget.workspaceId),
            });
          }
          return { kind: "document", document: verified };
        }
        const verified = requireVerifiableUpload(res.upload);
        return { kind: "upload", upload: verified };
      } catch (err) {
        if (activeRef.current === upload) {
          setProgress(null);
        }
        throw err;
      } finally {
        if (activeRef.current === upload) {
          activeRef.current = null;
        }
      }
    },
    [findResumable, opts?.concurrency, opts?.fetch, opts?.retryDelaysMs, qc, storage],
  );

  const pause = useCallback(() => {
    activeRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    activeRef.current?.resume();
  }, []);

  const cancel = useCallback(
    async (file?: File | Blob, filename?: string) => {
      const active = activeRef.current;
      activeRef.current = null;
      if (active) {
        await active.cancel();
      } else if (file) {
        const key = uploadFileKey(file, resolveFilename(file, filename));
        try {
          clearResumableUpload(storage, key, targetRef.current);
        } catch {
          // Storage cleanup is best-effort.
        }
      }
      setProgress(null);
    },
    [storage],
  );

  const reset = useCallback(() => {
    if (!activeRef.current) {
      setProgress(null);
    }
  }, []);

  const phase = progress?.phase ?? null;
  const percentage =
    progress !== null
      ? progress.totalBytes > 0
        ? Math.min(100, Math.floor((progress.sentBytes / progress.totalBytes) * 100))
        : 0
      : null;
  const isPending = phase !== null && ACTIVE_PHASES.has(phase);

  return useMemo(
    () => ({
      progress,
      phase,
      percentage,
      isPending,
      start,
      pause,
      resume,
      cancel,
      reset,
      findResumable,
      hasResumable,
    }),
    [
      progress,
      phase,
      percentage,
      isPending,
      start,
      pause,
      resume,
      cancel,
      reset,
      findResumable,
      hasResumable,
    ],
  );
}
