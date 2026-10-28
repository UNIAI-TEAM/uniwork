"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChunkedUploadError } from "@uniwork/core/documents/chunked-upload";
import { isUploadableName, readDroppedFolders, type FolderUploadEntry } from "@uniwork/core/documents/folder-upload";
import { DEFAULT_DOCUMENT_MAX_BYTES } from "@uniwork/core/documents/limits";
import { documentErrorMessage, documentUploadValidationMessage } from "./document-error-message";
import { refusalMessage } from "./folder-upload/folder-upload-copy";

export function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function isDirectoryItem(item: DataTransferItem): boolean {
  return item.kind === "file" && Boolean(item.webkitGetAsEntry?.()?.isDirectory);
}

/** The loose files of a drop that also holds folders; `dataTransfer.files` lists a folder as a bogus File, so it cannot be used there. */
function looseFilesOf(items: ArrayLike<DataTransferItem>): File[] {
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file" || isDirectoryItem(item)) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
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
 *
 * Dropped folders go to `onFolders` (one entry list per folder, UNI-2052);
 * without it they are skipped with one toast and the loose files still upload.
 * While `foldersReady` is false (the config that says whether the server takes
 * folder uploads has not answered) a dropped folder is read at once but waits
 * for the answer before it is handed over or explained. A folder cut at the
 * read bound (more than `maxFolderFiles * 4` uploadable files) is refused here, with the lower-bound
 * count, rather than staged half-read.
 *
 * Two or more loose files in one drop go to `onFiles` as ONE multi-file run
 * (ADDENDUM 2), after the drop's folders; a single loose file, or any files
 * when `onFiles` is absent (no folder upload on the server), take the old
 * one-file-at-a-time queue. Until `foldersReady`, several files wait too.
 */
export function useDropUpload({
  enabled,
  upload,
  maxBytes = DEFAULT_DOCUMENT_MAX_BYTES,
  onFolders,
  onFiles,
  foldersReady = true,
  maxFolderFiles,
  uploadExtensions,
}: {
  enabled: boolean;
  upload: (file: File) => Promise<void>;
  maxBytes?: number;
  onFolders?: (folders: FolderUploadEntry<File>[][]) => void;
  /** Takes two or more loose files of one drop as one multi-file run; gated like `onFolders`. */
  onFiles?: (files: File[]) => void;
  /** False while the config that decides `onFolders` is still loading. */
  foldersReady?: boolean;
  /** `max_files` of the folder-upload limits, for the read bound of a dropped folder. */
  maxFolderFiles?: number;
  /** `upload_extensions` of the document limits, the list the planner gets; only files it allows count toward the read bound. */
  uploadExtensions?: readonly string[];
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
  const folderGate = useRef({ onFolders, onFiles, ready: foldersReady, maxFolderFiles, waiters: [] as (() => void)[] });
  folderGate.current.onFolders = onFolders;
  folderGate.current.onFiles = onFiles;
  folderGate.current.ready = foldersReady;
  folderGate.current.maxFolderFiles = maxFolderFiles;
  useEffect(() => {
    if (!foldersReady) return;
    const { waiters } = folderGate.current;
    folderGate.current.waiters = [];
    for (const wake of waiters) wake();
  }, [foldersReady]);

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
              if (entry.toastId !== undefined) toast.dismiss(entry.toastId);
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

  const whenFoldersReady = (): Promise<void> =>
    folderGate.current.ready ? Promise.resolve() : new Promise<void>((resolve) => folderGate.current.waiters.push(resolve));

  /** Hands a read drop to `onFolders` once the config has answered; says so when there is nothing to hand it to. */
  const stageDroppedFolders = async (reading: Promise<Awaited<ReturnType<typeof readDroppedFolders>>>) => {
    let read: Awaited<typeof reading>;
    try {
      read = await reading;
    } catch {
      toast.error(t("documents.folder_upload.toast.read_failed"));
      return;
    }
    await whenFoldersReady();
    const { onFolders: handler, maxFolderFiles: limit } = folderGate.current;
    if (!handler) {
      toast.info(t("documents.folder_upload.toast.folders_unavailable"));
      return;
    }
    const staged = read.folders.filter((entries, index) => {
      if (!read.truncated[index]) return true;
      // The read list also holds files the planner skips; only the uploadable ones were counted toward the bound.
      const uploadable = entries.filter((entry) => isUploadableName(entry.path.split("/").at(-1) ?? "", uploadExtensions)).length;
      toast.error(t("documents.folder_upload.toast.refused", { name: entries[0]?.path.split("/")[0] ?? "" }), {
        description: refusalMessage(
          t,
          { code: "too_many_files", limit: limit ?? 0, actual: uploadable - 1 },
          i18n.language,
          { lowerBound: true },
        ),
      });
      return false;
    });
    if (staged.length > 0) handler(staged);
  };

  /** Several loose files: one multi-file run once the config allows it, else the old queue. */
  const stageLooseFiles = async (files: File[]) => {
    if (!folderGate.current.ready) await whenFoldersReady();
    const handler = folderGate.current.onFiles;
    if (handler) handler(files);
    else void enqueueUpload(files);
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
          const items = event.dataTransfer.items;
          if (items && Array.from(items).some(isDirectoryItem)) {
            // The browser empties the item list when this tick ends, so the
            // loose files and the folder walk both start before any await.
            const loose = looseFilesOf(items);
            const { onFolders: handler, ready } = folderGate.current;
            const unavailable = ready && !handler;
            const reading = unavailable ? null : readDroppedFolders(items, { maxFiles: maxFolderFiles, uploadExtensions });
            if (unavailable) toast.info(t("documents.folder_upload.toast.folders_unavailable"));
            const several = loose.length >= 2 && !unavailable;
            if (loose.length > 0 && !several) void enqueueUpload(loose);
            // The loose files' run queues behind the drop's folders.
            if (reading) void stageDroppedFolders(reading).then(() => (several ? stageLooseFiles(loose) : undefined));
            return;
          }
          const files = Array.from(event.dataTransfer.files);
          if (files.length >= 2) void stageLooseFiles(files);
          else if (files.length > 0) void enqueueUpload(files);
        },
      }
    : {};

  return { active, zoneProps };
}
