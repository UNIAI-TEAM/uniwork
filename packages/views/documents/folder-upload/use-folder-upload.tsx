"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { createFolderUploadTransport } from "@uniwork/core/api/endpoints/documents-folder-uploads";
import type { DocumentLimits } from "@uniwork/core/api/endpoints/config";
import { documentKeys } from "@uniwork/core/documents/keys";
import {
  entriesFromInputFiles,
  folderUploadLimits,
  planFolderUpload,
  runFolderUpload,
  type FolderUploadEntry,
  type FolderUploadHandle,
  type FolderUploadReport,
  type FolderUploadTransport,
} from "@uniwork/core/documents/folder-upload";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { nodeLevel, siblingsOf } from "../document-tree-model";
import { runErrorMessage } from "./folder-upload-copy";
import { FolderUploadDialog } from "./folder-upload-dialog";
import { FolderUploadReportDialog } from "./folder-upload-report-dialog";
import { createFolderUploadToast } from "./folder-upload-toast";

/** Where a staged folder lands, captured when it is picked or dropped so navigating away does not retarget it. */
interface Destination {
  /** The open folder; null at the workspace root, where the upload goes to My Folder. */
  parentId: string | null;
  name: string;
  /** Tree level of the destination for the depth check: workspace root 0, My Folder 1. */
  level: number;
  siblingNames: string[];
  shared: boolean;
}

interface StagedFolder {
  entries: FolderUploadEntry<File>[];
  destination: Destination;
}

interface ReportView {
  name: string;
  report: FolderUploadReport;
  handle: FolderUploadHandle;
}

export interface UseFolderUploadOptions {
  wsId: string;
  /** The viewer may create here; without it there is no entry point and no input. */
  enabled: boolean;
  /** Open folder id; null at the workspace root. */
  folderId: string | null;
  /** The open folder's name, or My Folder's at the root. */
  destinationName: string;
  tree: DocumentTreeNode[];
  limits: DocumentLimits;
  /** The workspace's My Folder when it is known; used when no folder is open. */
  myFolderId: string | null;
  resolveRootParent: () => Promise<string>;
  /** True when the open folder already shares with the workspace. */
  parentShared: boolean;
  /** Opens a folder of the library: "Mở thư mục" on the finished toast. */
  onOpenFolder: (folderId: string) => void;
  /** Injected by tests; the page uses the HTTP transport of `wsId`. */
  transport?: FolderUploadTransport;
}

/**
 * Folder upload for the library (UNI-2052): the hidden directory input, the
 * queue of staged folders (several dropped at once open one pre-flight dialog
 * after another), the run with its single toast, and the report of what failed.
 * `available` is false (and `dialogs` renders nothing) when the viewer may not create here or the server has no folder uploads.
 */
export function useFolderUpload({
  wsId,
  enabled,
  folderId,
  destinationName,
  tree,
  limits,
  myFolderId,
  resolveRootParent,
  parentShared,
  onOpenFolder,
  transport,
}: UseFolderUploadOptions) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const runLimits = useMemo(() => folderUploadLimits(limits), [limits]);
  const available = enabled && runLimits !== null;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [queue, setQueue] = useState<StagedFolder[]>([]);
  const [pending, setPending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportView, setReportView] = useState<ReportView | null>(null);
  const [retrying, setRetrying] = useState(false);
  const latest = useRef({ onOpenFolder, resolveRootParent, myFolderId, t, locale: i18n.language });
  latest.current = { onOpenFolder, resolveRootParent, myFolderId, t, locale: i18n.language };

  const head = queue[0] ?? null;
  const plan = useMemo(
    () =>
      head && runLimits
        ? planFolderUpload(head.entries, {
            limits: runLimits,
            parentLevel: head.destination.level,
            siblingNames: head.destination.siblingNames,
          })
        : null,
    [head, runLimits],
  );

  const destinationNow = useCallback((): Destination => {
    const parentId = folderId ?? myFolderId;
    return {
      parentId: folderId,
      name: destinationName,
      level: parentId ? (nodeLevel(tree, parentId) ?? 1) : 1,
      siblingNames: siblingsOf(tree, parentId).map((node) => node.title),
      shared: parentShared,
    };
  }, [folderId, myFolderId, destinationName, tree, parentShared]);

  /** Stage folders read from a drop or the picker; each gets its own dialog, in order. */
  const addFolders = useCallback(
    (lists: FolderUploadEntry<File>[][]) => {
      if (!available) return;
      const destination = destinationNow();
      const staged = lists.filter((entries) => entries.length > 0).map((entries) => ({ entries, destination }));
      // An empty folder has nothing to plan: say so instead of opening a dialog with no name.
      if (staged.length < lists.length) toast.error(t("documents.folder_upload.refusal.nothing_to_upload"));
      if (staged.length > 0) setQueue((q) => [...q, ...staged]);
    },
    [available, destinationNow, t],
  );

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  const dismissHead = () => {
    setQueue((q) => q.slice(1));
    setPending(false);
    setWaiting(false);
    setError(null);
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: documentKeys.listRoot(wsId) });
    void queryClient.invalidateQueries({ queryKey: documentKeys.treeRoot(wsId) });
  };

  const showReport = (name: string, report: FolderUploadReport, handle: FolderUploadHandle) =>
    setReportView({ name, report, handle });

  const confirm = async ({ shareWithWorkspace }: { shareWithWorkspace: boolean }) => {
    if (!head || !plan || !runLimits || pending) return;
    const { entries, destination } = head;
    setPending(true);
    setError(null);
    let parentId: string;
    try {
      parentId = destination.parentId ?? latest.current.myFolderId ?? (await latest.current.resolveRootParent());
    } catch {
      setError(t("documents.folder_upload.error.unknown"));
      setPending(false);
      return;
    }
    const uploadToast = { current: null as ReturnType<typeof createFolderUploadToast> | null };
    const run: { handle: FolderUploadHandle | null } = { handle: null };
    let began = false;
    // The plan was answered: the dialog's job is done, the toast takes over.
    const begin = () => {
      if (began) return;
      began = true;
      dismissHead();
      uploadToast.current = createFolderUploadToast({
        t: latest.current.t,
        name: plan.rootTitle,
        total: plan.totals.files,
        onCancelAll: () => run.handle?.cancel(),
      });
    };
    const running = runFolderUpload({
      transport: transport ?? createFolderUploadTransport(wsId),
      plan,
      file: (index) => entries[index]?.file as File,
      parentId,
      shareWithWorkspace: !destination.shared && shareWithWorkspace,
      limits: {
        parallel: runLimits.parallel,
        completeBatch: runLimits.completeBatch,
        chunkedThresholdBytes: limits.chunked_upload_threshold_bytes,
      },
      onInvalidate: invalidate,
      onProgress: (progress) => {
        // Before the plan is answered the dialog stays; a refusal is reported by `done`.
        if (progress.phase === "planning" || progress.phase === "refused") return;
        if (progress.phase === "waiting") {
          setWaiting(true);
          return;
        }
        begin();
        // The end states are the settle step's to show; progress only counts while files go up.
        if (progress.phase === "uploading") uploadToast.current?.progress({ done: progress.done, total: progress.total });
      },
    });
    run.handle = running;
    const settle = (report: FolderUploadReport) => {
      begin();
      uploadToast.current?.settle({
        title: report.root.title,
        total: report.total,
        done: report.done,
        failed: report.failed.length,
        canceled: report.canceled,
        expired: report.expired,
        onOpenFolder: () => {
          if (report.root.id) latest.current.onOpenFolder(report.root.id);
        },
        onViewFailures: () => showReport(report.root.title, report, running),
      });
    };
    running.done.then(settle, (failure: unknown) => {
      if (began) {
        uploadToast.current?.dismiss();
        toast.error(runErrorMessage(latest.current.t, failure, latest.current.locale));
        return;
      }
      // Refused before anything was written: the dialog stays open and says why.
      setError(runErrorMessage(latest.current.t, failure, latest.current.locale));
      setPending(false);
      setWaiting(false);
    });
  };

  const retryFailed = async () => {
    if (!reportView || retrying) return;
    const { handle, name } = reportView;
    setRetrying(true);
    try {
      const report = await handle.retryFailed();
      if (report.failed.length === 0) {
        setReportView(null);
        toast.success(t("documents.folder_upload.toast.success", { count: report.done, name: report.root.title }));
      } else {
        setReportView({ name, report, handle });
      }
    } catch (failure: unknown) {
      toast.error(runErrorMessage(t, failure, i18n.language));
    } finally {
      setRetrying(false);
    }
  };

  const dialogs: ReactNode = available ? (
    <>
      <input
        ref={(node) => {
          inputRef.current = node;
          // React has no prop for the directory attribute.
          node?.setAttribute("webkitdirectory", "");
        }}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden
        data-testid="folder-upload-input"
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length > 0) addFolders([entriesFromInputFiles(files)]);
          // The same folder picked twice must still fire onChange.
          event.target.value = "";
        }}
      />
      <FolderUploadDialog
        open={head !== null}
        onOpenChange={(open) => {
          if (!open) dismissHead();
        }}
        plan={plan}
        destinationName={head?.destination.name ?? destinationName}
        parentShared={head?.destination.shared ?? false}
        queued={Math.max(0, queue.length - 1)}
        pending={pending}
        waiting={waiting}
        error={error}
        onSubmit={(options) => void confirm(options)}
      />
      <FolderUploadReportDialog
        open={reportView !== null}
        onOpenChange={(open) => {
          if (!open) setReportView(null);
        }}
        name={reportView?.name ?? ""}
        failures={reportView?.report.failed ?? []}
        canRetry={reportView?.report.canRetry ?? true}
        retrying={retrying}
        onRetry={() => void retryFailed()}
      />
    </>
  ) : null;

  return { available, openPicker, addFolders, dialogs };
}
