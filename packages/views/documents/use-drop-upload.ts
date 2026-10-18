"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChunkedUploadError } from "@uniwork/core/documents/chunked-upload";
import { DEFAULT_DOCUMENT_MAX_BYTES } from "@uniwork/core/documents/limits";
import { documentErrorMessage, documentUploadValidationMessage } from "./document-error-message";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

interface QueuedUploadEntry {
  file: File;
  /** Set by the Cancel action on the file's waiting toast. */
  canceled: boolean;
  toastId: string | number | undefined;
}

/**
 * Drag files from the desktop onto the library to upload them into the open
 * folder. Each file is its own create (awaited, one after another); the list
 * refreshes from the server when each lands. Nothing happens for a viewer.
 */
export function useDropUpload({
  enabled,
  upload,
  maxBytes = DEFAULT_DOCUMENT_MAX_BYTES,
}: {
  enabled: boolean;
  upload: (file: File) => Promise<void>;
  maxBytes?: number;
}) {
  const { t, i18n } = useTranslation();
  const [active, setActive] = useState(false);
  // dragenter/dragleave fire for every child; count them to know when the
  // pointer really left the zone.
  const depth = useRef(0);
  // One file at a time. The chunked hook keeps a single active upload, so a
  // second drop mid-upload would overwrite it and the first toast's Cancel
  // would cancel the second upload (R2-3). Each drop waits for the previous
  // one to settle — and every file waiting in line gets its own toast (I-1).
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const jobsRef = useRef<QueuedUploadEntry[][]>([]);

  // Queued toasts do not outlive the zone that owns them.
  useEffect(
    () => () => {
      for (const job of jobsRef.current) {
        for (const entry of job) {
          if (entry.toastId !== undefined) toast.dismiss(entry.toastId);
        }
      }
    },
    [],
  );

  const uploadAll = async (files: QueuedUploadEntry[]) => {
    let done = 0;
    for (const entry of files) {
      // The file's turn: its waiting toast retires and the caller's progress
      // toast takes over, so one file is never covered by two toasts.
      if (entry.toastId !== undefined) toast.dismiss(entry.toastId);
      if (entry.canceled) continue;
      const invalid = documentUploadValidationMessage(entry.file, maxBytes, t, i18n.language);
      if (invalid) {
        toast.error(invalid);
        continue;
      }
      try {
        await upload(entry.file);
        done += 1;
      } catch (error) {
        if (error instanceof ChunkedUploadError && error.code === "upload_canceled") {
          continue;
        }
        toast.error(
          documentErrorMessage(error, t, "documents.home.drop_failed", {
            locale: i18n.language,
            file: entry.file,
            maxBytes,
            fallbackOpts: { name: entry.file.name },
          }),
        );
      }
    }
    if (done > 0) toast.success(t("documents.home.drop_done", { count: done }));
  };

  const enqueueUpload = (files: File[]): Promise<void> => {
    // A file is queued when something is already working through the list or
    // it sits behind a sibling in the same drop.
    const entries: QueuedUploadEntry[] = files.map((file, index) => {
      const entry: QueuedUploadEntry = { file, canceled: false, toastId: undefined };
      if (jobsRef.current.length > 0 || index > 0) {
        entry.toastId = toast.loading(t("documents.upload.drop_queued", { name: file.name }), {
          action: {
            label: t("documents.upload.cancel"),
            onClick: () => {
              entry.canceled = true;
            },
          },
        });
      }
      return entry;
    });
    jobsRef.current.push(entries);
    const next = chainRef.current.then(async () => {
      try {
        await uploadAll(entries);
      } finally {
        jobsRef.current = jobsRef.current.filter((job) => job !== entries);
      }
    });
    // Keep the chain alive after a failed drop: `uploadAll` swallows per-file
    // errors, but a throw of its own must not strand every later drop.
    chainRef.current = next.catch(() => undefined);
    return next;
  };

  const zoneProps = enabled
    ? {
        onDragEnter: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          depth.current += 1;
          setActive(true);
        },
        onDragOver: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setActive(false);
        },
        onDrop: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          depth.current = 0;
          setActive(false);
          const files = Array.from(event.dataTransfer.files);
          if (files.length > 0) void enqueueUpload(files);
        },
      }
    : {};

  return { active, zoneProps };
}
