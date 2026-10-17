"use client";

import { useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChunkedUploadError } from "@uniwork/core/documents/chunked-upload";
import { DEFAULT_DOCUMENT_MAX_BYTES } from "@uniwork/core/documents/limits";
import { documentErrorMessage, documentUploadValidationMessage } from "./document-error-message";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
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
  // One drop at a time. The chunked hook keeps a single active upload, so a
  // second drop mid-upload would overwrite it and the first toast's Cancel
  // would cancel the second upload (R2-3). Each drop waits for the previous
  // one to settle.
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const uploadAll = async (files: File[]) => {
    let done = 0;
    for (const file of files) {
      const invalid = documentUploadValidationMessage(file, maxBytes, t, i18n.language);
      if (invalid) {
        toast.error(invalid);
        continue;
      }
      try {
        await upload(file);
        done += 1;
      } catch (error) {
        if (error instanceof ChunkedUploadError && error.code === "upload_canceled") {
          continue;
        }
        toast.error(
          documentErrorMessage(error, t, "documents.home.drop_failed", {
            locale: i18n.language,
            file,
            maxBytes,
            fallbackOpts: { name: file.name },
          }),
        );
      }
    }
    if (done > 0) toast.success(t("documents.home.drop_done", { count: done }));
  };

  const enqueueUpload = (files: File[]): Promise<void> => {
    const next = queueRef.current.then(() => uploadAll(files));
    // Keep the chain alive after a failed drop: `uploadAll` swallows per-file
    // errors, but a throw of its own must not strand every later drop.
    queueRef.current = next.catch(() => undefined);
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
