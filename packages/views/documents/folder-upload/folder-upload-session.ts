import type { FolderUploadEntry, FolderUploadHandle, FolderUploadReport } from "@uniwork/core/documents/folder-upload";
import type { FolderUploadMode } from "./folder-upload-copy";
import type { FolderUploadToast } from "./folder-upload-toast";

// The shapes of a folder-upload session (use-folder-upload.tsx): what is staged,
// what a run shares with its toast and report, and how a finished batch is given up.

/** Where a staged folder lands, captured when it is picked or dropped so navigating away does not retarget it. */
export interface Destination {
  /** The open folder; null at the workspace root, where the upload goes to My Folder. */
  parentId: string | null;
  name: string;
  /** Tree level of the destination for the depth check: workspace root 0, My Folder 1. */
  level: number;
  siblingNames: string[];
  shared: boolean;
  /** Outside My Folder (ADR 0037): folders created here are visible to the workspace. The root means My Folder, so never. */
  inWorkspace: boolean;
}

export interface StagedFolder {
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

export function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `fu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** One run's link from the runner's progress to the toast that shows it. */
export interface RunChannel {
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
export function abandon(channel: RunChannel): void {
  if (channel.abandoned || channel.retryToast) return;
  channel.abandoned = true;
  channel.handle?.cancel();
}

export interface ReportView {
  name: string;
  report: FolderUploadReport;
  channel: RunChannel;
}
