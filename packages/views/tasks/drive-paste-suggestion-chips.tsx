"use client";

import { useCallback, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDriveConnections, useTaskDriveFiles } from "@uniwork/core/drive";
import type { CreateTaskDraftDriveFile } from "@uniwork/core/tasks/stores/create-task-draft-store";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { GoogleDriveMark } from "../common/provider-icons";
import {
  useDrivePicker,
  type DrivePickedFile,
  type DrivePickerAdapter,
} from "../integrations/drive-picker";
import { useDriveAvailable } from "../settings/components/drive-integration-row";
import type {
  DriveFileUrlKind,
  DriveFileUrlMatch,
} from "./drive-paste-url";

interface UseDrivePasteSuggestionsOptions {
  /**
   * File IDs already linked to the task or present in the create-task draft.
   * Pasted IDs in this set are skipped, and any visible suggestion chip whose
   * ID enters this set is automatically hidden.
   */
  existingFileIds?: Iterable<string>;
}

interface UseDrivePasteSuggestionsReturn {
  /** Visible candidate file IDs to render as suggestion chips. */
  suggestedFileIds: string[];
  /** Optional map of file ID -> parsed URL kind (`google_doc`, `google_sheet`, `google_slide`, `drive_file`). */
  fileKindsById: Readonly<Record<string, DriveFileUrlKind>>;
  /** Callback passed to `ContentEditor` (`onPasteDriveFileIds`). */
  onPasteDriveFileIds: (
    fileIds: string[],
    matches?: DriveFileUrlMatch[],
  ) => void;
  /** Dismisses a suggestion chip so the same ID is not re-suggested in this session. */
  dismissFileId: (fileId: string) => void;
  /** Clears a suggestion chip after it has been picked/linked. */
  resolveFileId: (fileId: string) => void;
  /** Resets all state (e.g. when switching tasks or starting a new draft). */
  reset: () => void;
}

/**
 * Tracks pasted Google Drive file IDs for a task description editor (spec §7.5, QĐ 8):
 * - Deduplicates pasted IDs while preserving order of appearance.
 * - Skips IDs already linked to the task or present in the create-task draft.
 * - Remembers dismissed IDs for the current editing session so re-pasting a
 *   dismissed URL does not re-open the chip.
 */
export function useDrivePasteSuggestions({
  existingFileIds,
}: UseDrivePasteSuggestionsOptions = {}): UseDrivePasteSuggestionsReturn {
  const [candidates, setCandidates] = useState<string[]>([]);
  const [fileKindsById, setFileKindsById] = useState<
    Record<string, DriveFileUrlKind>
  >({});
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const existingSet = useMemo(
    () => new Set(existingFileIds ?? []),
    [existingFileIds],
  );

  const onPasteDriveFileIds = useCallback(
    (fileIds: string[], matches?: DriveFileUrlMatch[]) => {
      if (fileIds.length === 0) return;
      if (matches && matches.length > 0) {
        setFileKindsById((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const m of matches) {
            if (m.id && m.kind && next[m.id] !== m.kind) {
              next[m.id] = m.kind;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
      setCandidates((prev) => {
        let changed = false;
        const next = [...prev];
        for (const id of fileIds) {
          if (!id || next.includes(id)) continue;
          next.push(id);
          changed = true;
        }
        return changed ? next : prev;
      });
    },
    [],
  );

  const dismissFileId = useCallback((fileId: string) => {
    setDismissed((prev) => {
      if (prev.has(fileId)) return prev;
      const next = new Set(prev);
      next.add(fileId);
      return next;
    });
    setCandidates((prev) => prev.filter((id) => id !== fileId));
  }, []);

  const resolveFileId = useCallback((fileId: string) => {
    setCandidates((prev) => prev.filter((id) => id !== fileId));
  }, []);

  const reset = useCallback(() => {
    setCandidates([]);
    setFileKindsById({});
    setDismissed(new Set());
  }, []);

  const suggestedFileIds = useMemo(
    () =>
      candidates.filter((id) => !existingSet.has(id) && !dismissed.has(id)),
    [candidates, dismissed, existingSet],
  );

  return {
    suggestedFileIds,
    fileKindsById,
    onPasteDriveFileIds,
    dismissFileId,
    resolveFileId,
    reset,
  };
}

interface DrivePasteSuggestionChipsProps {
  workspaceId: string;
  /** When set, links the picked file directly to this task (task detail flow). */
  taskId?: string;
  /** Candidate file IDs from `useDrivePasteSuggestions`. */
  suggestedFileIds: string[];
  /** Optional map of file ID -> parsed URL kind used to disambiguate when 2+ chips are shown. */
  fileKindsById?: Readonly<Record<string, DriveFileUrlKind>>;
  onDismiss: (fileId: string) => void;
  onResolved?: (fileId: string) => void;
  /**
   * Draft mode callback (create-task manual panel): when provided and `taskId`
   * is omitted, opens Picker with `linkOnPick: false` and hands picked files to
   * the draft state.
   */
  onDraftFilesPicked?: (
    connectionId: string,
    files: Array<{ id: string; name: string; mimeType: string }>,
  ) => void;
  /**
   * Optional draft Drive files (create-task manual panel) used to filter out
   * already-drafted file IDs.
   */
  draftDriveFiles?: CreateTaskDraftDriveFile[];
  /** Test / Storybook override for the Google Picker adapter. */
  pickerAdapter?: DrivePickerAdapter;
  className?: string;
}

/**
 * Renders dismissible Google Drive paste suggestion chips under a task
 * description editor (spec §7.5, QĐ 8).
 *
 * - Rendered only when `useDriveAvailable()` is true.
 * - Each chip is a button group (`role="group"`) with a primary action button
 *   ("Liên kết tệp Google Drive này vào việc?" when ≥1 connection exists, or
 *   "Kết nối Google Drive để liên kết" when no connection exists) and a
 *   labelled dismiss button.
 * - Clicking the action button calls `picker.open({ fileIds: [id], multiselect: false, linkOnPick })`,
 *   which runs the W3 Picker flow (or opens the W1/W3 connect popup dialog when
 *   no connection exists). Never calls the server with the URL.
 */
export function DrivePasteSuggestionChips({
  workspaceId,
  taskId,
  suggestedFileIds,
  fileKindsById,
  onDismiss,
  onResolved,
  onDraftFilesPicked,
  draftDriveFiles,
  pickerAdapter,
  className,
}: DrivePasteSuggestionChipsProps) {
  const driveAvailable = useDriveAvailable();

  if (!driveAvailable || suggestedFileIds.length === 0) {
    return null;
  }

  return (
    <DrivePasteSuggestionChipsInner
      workspaceId={workspaceId}
      taskId={taskId}
      suggestedFileIds={suggestedFileIds}
      fileKindsById={fileKindsById}
      onDismiss={onDismiss}
      onResolved={onResolved}
      onDraftFilesPicked={onDraftFilesPicked}
      draftDriveFiles={draftDriveFiles}
      pickerAdapter={pickerAdapter}
      className={className}
    />
  );
}

function DrivePasteSuggestionChipsInner({
  workspaceId,
  taskId,
  suggestedFileIds,
  fileKindsById,
  onDismiss,
  onResolved,
  onDraftFilesPicked,
  draftDriveFiles,
  pickerAdapter,
  className,
}: DrivePasteSuggestionChipsProps) {
  const { t } = useTranslation();
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  const connectionsQuery = useDriveConnections(workspaceId);
  const taskDriveFilesQuery = useTaskDriveFiles(workspaceId, taskId ?? "", {
    enabled: Boolean(taskId),
  });

  const existingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const df of draftDriveFiles ?? []) {
      ids.add(df.externalFileId);
    }
    for (const card of taskDriveFilesQuery.data ?? []) {
      ids.add(card.external_file_id);
    }
    return ids;
  }, [draftDriveFiles, taskDriveFilesQuery.data]);

  const visibleIds = useMemo(
    () => suggestedFileIds.filter((id) => !existingIds.has(id)),
    [existingIds, suggestedFileIds],
  );

  const isDraftMode = !taskId && Boolean(onDraftFilesPicked);

  const handlePicked = useCallback(
    ({
      connectionId,
      pickedFiles,
    }: {
      connectionId: string;
      pickedFiles: DrivePickedFile[];
    }) => {
      if (isDraftMode && onDraftFilesPicked) {
        onDraftFilesPicked(
          connectionId,
          pickedFiles.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
          })),
        );
        if (activeFileId) {
          onResolved?.(activeFileId);
        }
        for (const f of pickedFiles) {
          onResolved?.(f.id);
        }
      }
    },
    [activeFileId, isDraftMode, onDraftFilesPicked, onResolved],
  );

  const handleLinked = useCallback(
    (
      results: { results: Array<{ external_file_id: string; outcome: string }> },
      context: { connectionId: string; pickedFiles: DrivePickedFile[] },
    ) => {
      const succeeded = results.results.some(
        (item) =>
          item.outcome === "linked" || item.outcome === "already_linked",
      );
      if (succeeded) {
        if (activeFileId) {
          onResolved?.(activeFileId);
        }
        for (const f of context.pickedFiles) {
          onResolved?.(f.id);
        }
      }
    },
    [activeFileId, onResolved],
  );

  const picker = useDrivePicker({
    wsId: workspaceId,
    taskId: taskId ?? undefined,
    forTask: true,
    adapter: pickerAdapter,
    onPicked: handlePicked,
    onLinked: handleLinked,
  });

  // When the connections query has resolved with 0 connections, show the
  // no-connection copy ("Kết nối Google Drive để liên kết", spec §7.5).
  const hasNoConnection =
    connectionsQuery.isSuccess &&
    (connectionsQuery.data?.connections.length ?? 0) === 0;

  if (visibleIds.length === 0) {
    return <>{picker.dialogs}</>;
  }

  const promptText = hasNoConnection
    ? t("drive.paste_chip.connect_prompt")
    : t("drive.paste_chip.link_prompt");
  const showKindCue = visibleIds.length > 1;

  return (
    <>
      <div
        data-testid="drive-paste-suggestion-chips"
        className={cn(
          "relative z-50 flex shrink-0 flex-wrap gap-2",
          className,
        )}
      >
        {visibleIds.map((fileId) => {
          const kind = fileKindsById?.[fileId] ?? "drive_file";
          const kindLabel = showKindCue
            ? t(`drive.paste_chip.file_kinds.${kind}`)
            : null;
          return (
            <div
              key={fileId}
              role="group"
              aria-label={t("drive.paste_chip.group_aria")}
              data-testid={`drive-paste-suggestion-chip-${fileId}`}
              className="inline-flex min-h-9 min-w-0 max-w-full items-center gap-1 rounded-lg border border-brand/25 bg-brand-subtle py-1 pr-1.5 pl-1.5 text-caption text-foreground"
            >
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={picker.pending}
                onClick={() => {
                  setActiveFileId(fileId);
                  picker.open({
                    fileIds: [fileId],
                    multiselect: false,
                    linkOnPick: !isDraftMode,
                  });
                }}
                className="h-auto min-h-7 min-w-0 shrink gap-2 px-1.5 py-0.5 text-left text-caption font-medium whitespace-normal text-foreground hover:bg-brand/10 hover:text-primary dark:hover:bg-brand/20"
              >
                <GoogleDriveMark
                  className="size-4 shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0 break-words">
                  {kindLabel ? `${promptText} · ${kindLabel}` : promptText}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("drive.paste_chip.dismiss_aria")}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => onDismiss(fileId)}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          );
        })}
      </div>
      {picker.dialogs}
    </>
  );
}
