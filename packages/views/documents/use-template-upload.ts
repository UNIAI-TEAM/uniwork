"use client";

import { useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { chunkedUploadThreshold } from "@uniwork/core/documents/chunked-upload";
import { useCreateDocumentFile, useDocumentLimits } from "@uniwork/core/documents/hooks";
import { DOCUMENT_UPLOAD_ACCEPT, formatDocumentSizeMB } from "@uniwork/core/documents/limits";
import { documentErrorMessage, documentUploadValidationMessage } from "./document-error-message";
import { hasFiles, isDirectoryItem } from "./use-drop-upload";

/**
 * The one way a file becomes a template from the Templates screen, for the
 * picker and the drop alike: visible to the whole workspace and marked as a
 * template, no folder and no destination (never My Folder), never a chunked
 * session. A file above the chunked threshold is refused with its own message
 * and nothing is sent; null = no limit beyond the server's own upload cap.
 */
export function useTemplateUpload(wsId: string, enabled: boolean) {
  const { t, i18n } = useTranslation();
  const limits = useDocumentLimits({ enabled });
  const create = useCreateDocumentFile(wsId);

  const upload = async (file: File) => {
    const threshold = chunkedUploadThreshold(limits);
    if (threshold !== null && file.size > threshold) {
      toast.error(t("documents.templates.too_large", { size: formatDocumentSizeMB(threshold, i18n.language) }));
      return;
    }
    const invalid = documentUploadValidationMessage(file, limits.upload_max_bytes, t, i18n.language);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    try {
      const doc = await create.mutateAsync({ file, meta: { visibility: "workspace", template: true } });
      toast.success(t("documents.templates.uploaded", { title: doc.title }));
    } catch (error) {
      toast.error(
        documentErrorMessage(error, t, "documents.templates.upload_failed", {
          locale: i18n.language,
          file,
          maxBytes: limits.upload_max_bytes,
        }),
      );
    }
  };
  const accept = limits.upload_extensions?.length
    ? limits.upload_extensions.map((extension) => `.${extension}`).join(",")
    : DOCUMENT_UPLOAD_ACCEPT;
  return { upload, pending: create.isPending, accept };
}

/**
 * The drop zone of the Templates screen, in place of the page's own zone
 * there: dropped files go through `useTemplateUpload` one after another, a
 * dropped folder is refused with a toast and nothing is sent. It always
 * `preventDefault`s a file drag, so the browser never opens the file.
 */
export function useTemplatesDrop(wsId: string, enabled: boolean) {
  const { t } = useTranslation();
  const { upload } = useTemplateUpload(wsId, enabled);
  const [active, setActive] = useState(false);
  // dragenter/dragleave fire for every child; count them to know when the pointer really left.
  const depth = useRef(0);
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
          const items = event.dataTransfer.items;
          if (items && Array.from(items).some(isDirectoryItem)) {
            toast.error(t("documents.templates.no_folders"));
            return;
          }
          // The browser empties the list when this tick ends: copy it before any await.
          const files = Array.from(event.dataTransfer.files);
          void (async () => {
            for (const file of files) await upload(file);
          })();
        },
      }
    : undefined;
  return { zoneProps, active };
}
