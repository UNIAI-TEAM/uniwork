"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { deleteAskAttachment, downloadAskAttachment, uploadAskAttachment } from "../api/endpoints/ai-attachments";
import { errorCode } from "../api/http";
import type { AiAttachment, AskUploadedFile } from "../types/ai";
import { aiKeys } from "./hooks";

// The server's limits (5 files of 20 << 20, an image of 7.5 MB); the server checks them again, this only spares the
// round trip. An image is capped lower because the model takes one of at most 10 MB once base64-encoded.
export const ASK_FILE_MAX_BYTES = { image: 7_500_000, file: 20 * 1024 * 1024 } as const;
export const ASK_FILES_MAX = 5;
export const ASK_FILES_TOTAL_MAX_BYTES = 20 * 1024 * 1024;

// DOC, XLS and PPT are not read. The server judges the content, not the name.
const EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".docx", ".xlsx", ".pptx", ".odt", ".txt", ".csv", ".md", ".markdown"];
const MIMES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "text/plain",
  "text/csv",
  "text/markdown",
];
/** The `accept` of the file input: extensions and MIME types. */
export const ASK_FILE_ACCEPT = [...EXTENSIONS, ...MIMES].join(",");

export type AskFileRefusal = "too_large" | "too_many" | "total_too_large" | "type_unsupported";

export interface StagedAskFile {
  /** Local id of the entry, stable across retries; not the server's file id. */
  key: string;
  file: File;
  status: "uploading" | "ready" | "error";
  /** 0..1 of the request body sent. */
  progress: number;
  uploaded?: AskUploadedFile;
  /** The server's error code (`ai_attachment_unreadable`, `media_unsupported`, …) or `upload_failed`; set when status is "error". */
  error?: string;
}

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

function extensionOf(file: File): string {
  const dot = file.name.lastIndexOf(".");
  return dot < 0 ? "" : file.name.slice(dot).toLowerCase();
}

// Browsers give no MIME for .md and odd ones for .csv, so a file passes on either its extension or its MIME type.
function typeSupported(file: File): boolean {
  return EXTENSIONS.includes(extensionOf(file)) || MIMES.includes(file.type.split(";")[0]!.trim().toLowerCase());
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.includes(extensionOf(file));
}

/** Why a file cannot join `count` staged files totalling `bytes`, or null. */
function refusal(file: File, count: number, bytes: number): AskFileRefusal | null {
  if (!typeSupported(file)) return "type_unsupported";
  if (file.size > (isImage(file) ? ASK_FILE_MAX_BYTES.image : ASK_FILE_MAX_BYTES.file)) return "too_large";
  if (count >= ASK_FILES_MAX) return "too_many";
  if (bytes + file.size > ASK_FILES_TOTAL_MAX_BYTES) return "total_too_large";
  return null;
}

/**
 * The uploaded files as the question's bubble shows them, in attach order, for
 * `ask(input, display)`. Their `id` is the upload's file_id: the stored
 * attachment's own id (the one that downloads) only exists once the messages
 * are refetched, and that refetch replaces the bubble.
 */
export function askDisplayAttachments(files: StagedAskFile[]): AiAttachment[] {
  return files.flatMap((x) =>
    x.status === "ready" && x.uploaded
      ? [{ id: x.uploaded.file_id, name: x.uploaded.name, mime: x.uploaded.mime, size: x.uploaded.size, kind: x.uploaded.kind }]
      : [],
  );
}

/** Fire and forget: an upload nobody sends is cleaned by the file store after 24 h anyway. */
function cancel(wsId: string, fileId: string): void {
  void deleteAskAttachment(wsId, fileId).catch(() => undefined);
}

/**
 * The files being attached to the next Ask UNI question: each is uploaded as
 * soon as it is added, and `ids` is what the question sends as
 * `attachment_ids`. Local composer state, so a hook rather than a store;
 * a workspace switch or unmount drops it.
 */
export function useAskAttachments(wsId: string) {
  const [files, setFiles] = useState<StagedAskFile[]>([]);
  // The list as of the latest change: two add() calls can run before React renders, and each must see the other's files.
  const list = useRef<StagedAskFile[]>([]);
  const requests = useRef(new Map<string, AbortController>());
  const seq = useRef(0);

  const commit = useCallback((next: StagedAskFile[]) => {
    list.current = next;
    setFiles(next);
  }, []);

  const patch = useCallback(
    (key: string, change: Partial<StagedAskFile>) => {
      if (list.current.some((x) => x.key === key)) commit(list.current.map((x) => (x.key === key ? { ...x, ...change } : x)));
    },
    [commit],
  );

  const upload = useCallback(
    (key: string, file: File) => {
      const ctrl = new AbortController();
      requests.current.set(key, ctrl);
      const done = () => {
        if (requests.current.get(key) === ctrl) requests.current.delete(key);
      };
      uploadAskAttachment(wsId, file, {
        signal: ctrl.signal,
        onProgress: (loaded, total) => patch(key, { progress: total > 0 ? loaded / total : 0 }),
      }).then(
        (uploaded) => {
          done();
          if (!list.current.some((x) => x.key === key)) {
            // Removed while the request was in flight, but the server had already stored the file.
            if (uploaded.file_id) cancel(wsId, uploaded.file_id);
            return;
          }
          if (!uploaded.file_id) patch(key, { status: "error", error: "upload_failed" });
          else patch(key, { status: "ready", progress: 1, uploaded });
        },
        (err: unknown) => {
          done();
          if (ctrl.signal.aborted) return; // removed or cleared: not a failure
          patch(key, { status: "error", error: errorCode(err) ?? "upload_failed" });
        },
      );
    },
    [wsId, patch],
  );

  const add = useCallback(
    (incoming: File[]): AskFileRefusal[] => {
      const refused: AskFileRefusal[] = [];
      const accepted: StagedAskFile[] = [];
      let count = list.current.length;
      let bytes = list.current.reduce((sum, x) => sum + x.file.size, 0);
      for (const file of incoming) {
        const why = refusal(file, count, bytes);
        if (why) {
          refused.push(why);
          continue;
        }
        count += 1;
        bytes += file.size;
        accepted.push({ key: `ask-file-${(seq.current += 1)}`, file, status: "uploading", progress: 0 });
      }
      if (accepted.length > 0) {
        commit([...list.current, ...accepted]);
        for (const x of accepted) upload(x.key, x.file);
      }
      return refused;
    },
    [commit, upload],
  );

  const remove = useCallback(
    (key: string) => {
      const found = list.current.find((x) => x.key === key);
      if (!found) return;
      requests.current.get(key)?.abort();
      requests.current.delete(key);
      commit(list.current.filter((x) => x.key !== key));
      if (found.uploaded) cancel(wsId, found.uploaded.file_id);
    },
    [commit, wsId],
  );

  const retry = useCallback(
    (key: string) => {
      const found = list.current.find((x) => x.key === key);
      if (found?.status !== "error") return;
      patch(key, { status: "uploading", progress: 0, error: undefined });
      upload(key, found.file);
    },
    [patch, upload],
  );

  // After a send, the files it carried (`keys`), or all of them. The uploaded files now belong to the sent question,
  // so they stay on the server; a request still in flight is cut, and cancelled if the server answers anyway.
  const clear = useCallback(
    (keys?: string[]) => {
      const gone = keys ? list.current.filter((x) => keys.includes(x.key)) : list.current;
      for (const x of gone) {
        requests.current.get(x.key)?.abort();
        requests.current.delete(x.key);
      }
      commit(keys ? list.current.filter((x) => !keys.includes(x.key)) : []);
    },
    [commit],
  );

  // A file the server would not take with a question (`ai_attachment_unreadable`): it stays, marked, until removed.
  const fail = useCallback((key: string, error: string) => patch(key, { status: "error", error }), [patch]);

  // A file belongs to the workspace it was uploaded to: leaving it forgets the list.
  useEffect(() => () => clear(), [wsId, clear]);

  const ids = useMemo(() => files.flatMap((x) => (x.status === "ready" && x.uploaded ? [x.uploaded.file_id] : [])), [files]);
  const busy = files.some((x) => x.status === "uploading");
  const blocked = files.some((x) => x.status === "error");

  return { files, add, remove, retry, clear, fail, ids, busy, blocked };
}

/**
 * A stored attachment's bytes, for drawing its picture: fetched once `enabled` (the chip has scrolled into view) and
 * kept, since a stored file never changes. A failed read is not retried; the chip keeps its icon.
 */
export function useAskAttachmentContent(wsId: string, attachmentId: string, enabled: boolean) {
  return useQuery({
    queryKey: aiKeys.attachmentContent(wsId, attachmentId),
    queryFn: () => downloadAskAttachment(wsId, attachmentId),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}
