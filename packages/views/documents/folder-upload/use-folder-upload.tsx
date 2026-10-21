"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { createFolderUploadTransport } from "@uniwork/core/api/endpoints/documents-folder-uploads";
import type { DocumentLimits } from "@uniwork/core/api/endpoints/config";
import { documentKeys } from "@uniwork/core/documents/keys";
import {
  entriesFromInputFiles,
  folderUploadLimits,
  planFileUpload,
  planFolderUpload,
  runFolderUpload,
  type FolderUploadEntry,
  type FolderUploadHandle,
  type FolderUploadReport,
  type FolderUploadTransport,
} from "@uniwork/core/documents/folder-upload";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { nodeLevel, siblingsOf } from "../document-tree-model";
import { runErrorMessage, type FolderUploadMode } from "./folder-upload-copy";
import { FolderUploadDialog } from "./folder-upload-dialog";
import { FolderUploadReportDialog } from "./folder-upload-report-dialog";
import { createFolderUploadToast, type FolderUploadToast } from "./folder-upload-toast";

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
  /** One folder, or loose files that go straight into the destination (ADDENDUM 2). */
  mode: FolderUploadMode;
  entries: FolderUploadEntry<File>[];
  destination: Destination;
  /**
   * Minted when the folder is staged, so a plan lost on the network is sent
   * again under the same key (no second tree, no second open batch). Mutable:
   * `share` is the flag the key was last sent with, null before the first try.
   */
  idempotency: { key: string; share: boolean | null };
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `fu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** One run's link from the runner's progress to the toast that shows it. */
interface RunChannel {
  handle: FolderUploadHandle | null;
  mode: FolderUploadMode;
  /** The folder "Mở thư mục" opens in files mode: the destination, once resolved. Folder mode opens the root. */
  destinationId: string | null;
  /** The first run's toast has its end state: later progress belongs to a retry. */
  settled: boolean;
  /** The toast of the retry under way, if any. */
  retryToast: FolderUploadToast | null;
  /** The toast showing the run's latest end state (the first run's, then each retry's). */
  shownToast: FolderUploadToast | null;
  /** The latest end state left failures in a batch that is still open. */
  failuresLeft: boolean;
  /** The batch was given up (report dismissed, or nothing left to retry) and canceled once. */
  abandoned: boolean;
  /** The user left the dialog while the plan was pending: the run cleans up in the background and owns no dialog. */
  left: boolean;
}

/**
 * Give up a batch that is done with: a batch with pending files stays open,
 * and counts against the user's 2 open batches, until it is canceled or
 * expires (24 h). The landed files stay. Never while a retry runs: closing
 * the old report then must not cancel it (R2-1).
 */
function abandon(channel: RunChannel): void {
  if (channel.abandoned || channel.retryToast) return;
  channel.abandoned = true;
  channel.handle?.cancel();
}

interface ReportView {
  name: string;
  report: FolderUploadReport;
  channel: RunChannel;
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
  /** The run the open dialog is waiting on (plan pending or Retry-After), until the toast takes over. */
  const dialogRun = useRef<RunChannel | null>(null);
  /** Every run started here, so an unmount can close the batches whose report goes with the page. */
  const runs = useRef(new Set<RunChannel>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const started = runs.current;
    return () => {
      mounted.current = false;
      // The report and its retry live in this page (R2-2): failures nobody can reach any more close
      // their batch now, and the toast drops "Xem". A run or retry still going does this when it settles.
      for (const channel of started) {
        if (!channel.failuresLeft || channel.retryToast) continue;
        abandon(channel);
        channel.shownToast?.close();
      }
    };
  }, []);
  const latest = useRef({ onOpenFolder, resolveRootParent, myFolderId, folderId, t, locale: i18n.language });
  latest.current = { onOpenFolder, resolveRootParent, myFolderId, folderId, t, locale: i18n.language };

  const head = queue[0] ?? null;
  const plan = useMemo(() => {
    if (!head || !runLimits) return null;
    const parentLevel = head.destination.level;
    return head.mode === "files"
      ? planFileUpload(head.entries, { limits: runLimits, parentLevel })
      : planFolderUpload(head.entries, { limits: runLimits, parentLevel, siblingNames: head.destination.siblingNames });
  }, [head, runLimits]);

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
      const staged = lists
        .filter((entries) => entries.length > 0)
        .map((entries) => ({
          mode: "folder" as const,
          entries,
          destination,
          idempotency: { key: newIdempotencyKey(), share: null },
        }));
      // An empty folder has nothing to plan: say so instead of opening a dialog with no name.
      if (staged.length < lists.length) toast.error(t("documents.folder_upload.refusal.nothing_to_upload"));
      if (staged.length > 0) setQueue((q) => [...q, ...staged]);
    },
    [available, destinationNow, t],
  );

  /** Stage several picked or dropped files as ONE files-mode run into the destination (ADDENDUM 2). */
  const addFiles = useCallback(
    (files: readonly File[]) => {
      if (!available || files.length === 0) return;
      const run: StagedFolder = {
        mode: "files",
        entries: entriesFromInputFiles(files),
        destination: destinationNow(),
        idempotency: { key: newIdempotencyKey(), share: null },
      };
      setQueue((q) => [...q, run]);
    },
    [available, destinationNow],
  );

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  /**
   * Cancel, Esc or x while the plan is pending: the user is out, so the dialog closes at once. The runner still
   * waits for the plan's answer (it cannot know a batch was planned before then), cancels that batch and settles
   * canceled in the background, with nothing left to show.
   */
  const cancelPending = () => {
    const channel = dialogRun.current;
    dialogRun.current = null;
    if (channel?.handle) {
      channel.left = true;
      channel.handle.cancel();
    }
    // Without a handle the destination was still resolving: the run never starts.
    dismissHead();
  };

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

  const showReport = (name: string, report: FolderUploadReport, channel: RunChannel) =>
    setReportView({ name, report: channel.abandoned ? { ...report, canRetry: false } : report, channel });

  /** Turn a run's (or a retry's) toast into its end state; "Xem" opens the report. */
  const settleToast = (target: FolderUploadToast, name: string, report: FolderUploadReport, channel: RunChannel) => {
    const title = report.root?.title ?? name;
    const openId = report.root?.id ?? (channel.mode === "files" ? channel.destinationId : null);
    channel.failuresLeft = report.failed.length > 0 && !report.canceled && !report.expired;
    // Unmounted: nobody can open the report or retry, so the batch closes now. An expired run has no batch left to
    // close, but its toast is closed all the same: "Xem" would open nothing and the toast must not stay forever.
    const closed = !mounted.current && (channel.failuresLeft || report.expired) && report.failed.length > 0;
    if (channel.failuresLeft && (!report.canRetry || closed)) abandon(channel);
    channel.shownToast = target;
    target.settle({
      title,
      total: report.total,
      done: report.done,
      failed: report.failed.length,
      canceled: report.canceled,
      expired: report.expired,
      // The folder on screen when the run ends, not when it started: the user may have moved on meanwhile.
      onOpenFolder:
        openId && openId !== latest.current.folderId
          ? () => latest.current.onOpenFolder(openId)
          : undefined,
      onViewFailures: () => showReport(title, report, channel),
      closed,
    });
  };

  const confirm = async ({ shareWithWorkspace }: { shareWithWorkspace: boolean }) => {
    if (!head || !plan || !runLimits || pending) return;
    const { mode, entries, destination, idempotency } = head;
    // Files mode has no root: the run is named after its destination.
    const name = plan.rootTitle ?? destination.name;
    const share = !destination.shared && shareWithWorkspace;
    // The flag is part of the plan body, and the server answers 409 to one key sent with two bodies.
    if (idempotency.share !== null && idempotency.share !== share) idempotency.key = newIdempotencyKey();
    idempotency.share = share;
    setPending(true);
    setError(null);
    const channel: RunChannel = {
      handle: null,
      mode,
      destinationId: null,
      settled: false,
      retryToast: null,
      shownToast: null,
      failuresLeft: false,
      abandoned: false,
      left: false,
    };
    dialogRun.current = channel;
    runs.current.add(channel);
    let parentId: string;
    try {
      parentId = destination.parentId ?? latest.current.myFolderId ?? (await latest.current.resolveRootParent());
    } catch {
      if (dialogRun.current !== channel) return;
      dialogRun.current = null;
      setError(t("documents.folder_upload.error.unknown"));
      setPending(false);
      return;
    }
    if (dialogRun.current !== channel) return;
    channel.destinationId = parentId;
    let uploadToast: FolderUploadToast | null = null;
    // The plan was answered: the dialog's job is done, the toast takes over.
    const begin = (): FolderUploadToast => {
      if (uploadToast) return uploadToast;
      // A run the user already left has no dialog to close: the head now belongs to the next folder.
      if (!channel.left) {
        dialogRun.current = null;
        dismissHead();
      }
      uploadToast = createFolderUploadToast({
        t: latest.current.t,
        name,
        total: plan.totals.files,
        onCancelAll: () => channel.handle?.cancel(),
        mode,
      });
      return uploadToast;
    };
    const running = runFolderUpload({
      transport: transport ?? createFolderUploadTransport(wsId),
      plan,
      file: (index) => entries[index]?.file as File,
      parentId,
      shareWithWorkspace: share,
      idempotencyKey: idempotency.key,
      limits: {
        parallel: runLimits.parallel,
        completeBatch: runLimits.completeBatch,
        chunkedThresholdBytes: limits.chunked_upload_threshold_bytes,
      },
      onInvalidate: invalidate,
      onProgress: (progress) => {
        // Files in storage count as up: their completes are batched.
        const counts = { done: progress.done + progress.stored, total: progress.total };
        if (progress.phase === "retrying") {
          channel.retryToast?.progress(counts);
          return;
        }
        // The first run's toast keeps its end state; whatever follows is not its to show.
        if (channel.settled) return;
        if (progress.phase === "waiting") {
          if (!channel.left) setWaiting(true);
          return;
        }
        // "uploading" means the plan was answered: the toast takes over. Before it the dialog
        // stays; the end states (a refusal, a cancel from the dialog) are the settle step's.
        if (progress.phase === "uploading") begin().progress(counts);
      },
    });
    channel.handle = running;
    running.done.then(
      (report) => {
        channel.settled = true;
        // Canceled from the dialog before the plan was answered (the 429 wait included): the user left, so the
        // dialog is already gone (`cancelPending`) and there is nothing to report.
        if (report.canceled && !uploadToast) return;
        settleToast(begin(), name, report, channel);
      },
      (failure: unknown) => {
        channel.settled = true;
        // The user left: a refusal of a plan they walked away from is not theirs to read.
        if (channel.left && !uploadToast) return;
        if (dialogRun.current === channel) dialogRun.current = null;
        if (uploadToast) {
          uploadToast.dismiss();
          toast.error(runErrorMessage(latest.current.t, failure, latest.current.locale, channel.mode));
          return;
        }
        // Refused before anything was written: the dialog stays open and says why.
        setError(runErrorMessage(latest.current.t, failure, latest.current.locale, channel.mode));
        setPending(false);
        setWaiting(false);
      },
    );
  };

  /** Retry from the report: the report gives way to the retry's own toast. */
  const retryFailed = () => {
    if (!reportView) return;
    const { name, report: last, channel } = reportView;
    const handle = channel.handle;
    if (!handle) return;
    setReportView(null);
    // A retry already runs (this report was reopened from the first toast): its own toast shows it. Closing is all
    // there is to do, and it never cancels (R2-1).
    if (channel.retryToast) return;
    const retryToast = createFolderUploadToast({
      t,
      name,
      total: last.total,
      done: last.done,
      onCancelAll: () => handle.cancel(),
      retry: true,
      mode: channel.mode,
    });
    channel.retryToast = retryToast;
    handle.retryFailed().then(
      (report) => {
        // The toast that showed the last end state gives way only now: if the retry call fails, it is the way back.
        const previous = channel.shownToast;
        channel.retryToast = null;
        settleToast(retryToast, name, report, channel);
        previous?.dismiss();
      },
      (failure: unknown) => {
        channel.retryToast = null;
        retryToast.dismiss();
        toast.error(runErrorMessage(latest.current.t, failure, latest.current.locale, channel.mode));
      },
    );
  };

  const dialogs: ReactNode = (
    <>
      {available ? (
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
              if (open) return;
              if (pending) cancelPending();
              else dismissHead();
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
        </>
      ) : null}
      {/* Outside the gate (R3-1): the report needs no create right, and "Xem" must work wherever the page has moved to. */}
      <FolderUploadReportDialog
        open={reportView !== null}
        onOpenChange={(open) => {
          if (open || !reportView) return;
          // Closed without a retry: nothing more will happen in this batch.
          abandon(reportView.channel);
          setReportView(null);
        }}
        name={reportView?.name ?? ""}
        failures={reportView?.report.failed ?? []}
        canRetry={reportView?.report.canRetry ?? false}
        mode={reportView?.channel.mode ?? "folder"}
        expired={reportView?.report.expired ?? false}
        onRetry={retryFailed}
      />
    </>
  );

  return { available, openPicker, addFolders, addFiles, dialogs };
}
