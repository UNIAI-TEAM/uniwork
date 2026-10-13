"use client";

import { useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Drag files from the desktop onto the library to upload them into the open
 * folder. Each file is its own create (awaited, one after another); the list
 * refreshes from the server when each lands. Nothing happens for a viewer.
 */
export function useDropUpload({ enabled, upload }: { enabled: boolean; upload: (file: File) => Promise<void> }) {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  // dragenter/dragleave fire for every child; count them to know when the
  // pointer really left the zone.
  const depth = useRef(0);

  const uploadAll = async (files: File[]) => {
    let done = 0;
    for (const file of files) {
      try {
        await upload(file);
        done += 1;
      } catch (error) {
        toast.error(apiErrorMessage(error) ?? t("documents.home.drop_failed", { name: file.name }));
      }
    }
    if (done > 0) toast.success(t("documents.home.drop_done", { count: done }));
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
          if (files.length > 0) void uploadAll(files);
        },
      }
    : {};

  return { active, zoneProps };
}
