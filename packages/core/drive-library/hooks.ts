"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  linkDriveFiles,
  type DriveFileLinkResults,
} from "../api/endpoints/drive";
import {
  getDriveFile,
  listDriveFiles,
  rebindDriveFile,
  unlinkDriveFile,
  type DriveFile,
  type DriveFileList,
  type DriveIconKind,
  type DriveLinkedTaskRef,
  type DriveSharingState,
  type DriveTaskCreationGroup,
  type DriveTasksCreatedSummary,
  type DriveViewerAccessState,
  type RebindDriveFileBody,
} from "../api/endpoints/drive-library";
import { driveLibraryKeys } from "./keys";

export {
  driveLibraryKeys,
  type DriveFile,
  type DriveFileList,
  type DriveIconKind,
  type DriveLinkedTaskRef,
  type DriveSharingState,
  type DriveTaskCreationGroup,
  type DriveTasksCreatedSummary,
  type DriveViewerAccessState,
};

const DRIVE_FILES_PAGE_SIZE = 50;

export interface UseDriveFilesOpts {
  connectionId?: string | null;
  limit?: number;
  enabled?: boolean;
}

/**
 * Infinite query for the caller's Google Drive files in the workspace (4.1).
 * Refetches on window focus so external changes (or desktop handoff) appear on return.
 */
export function useDriveFiles(wsId: string, opts?: UseDriveFilesOpts) {
  const connectionId = opts?.connectionId ?? null;
  const limit = opts?.limit ?? DRIVE_FILES_PAGE_SIZE;
  return useInfiniteQuery({
    queryKey: driveLibraryKeys.list(wsId, connectionId),
    queryFn: ({ pageParam, signal }) =>
      listDriveFiles(
        wsId,
        {
          connection_id: connectionId || undefined,
          cursor: pageParam || undefined,
          limit,
        },
        signal,
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: (opts?.enabled ?? true) && !!wsId,
    refetchOnWindowFocus: true,
  });
}

export interface UseDriveFileOpts {
  enabled?: boolean;
  retry?: boolean | number | ((failureCount: number, error: unknown) => boolean);
}

/**
 * Single Drive file reference for the 4.2 detail page.
 * Refetches on window focus so access or proposal updates reflect when returning from Google Drive.
 */
export function useDriveFile(wsId: string, driveFileId: string, opts?: UseDriveFileOpts) {
  return useQuery({
    queryKey: driveLibraryKeys.detail(wsId, driveFileId),
    queryFn: ({ signal }) => getDriveFile(wsId, driveFileId, signal),
    enabled: (opts?.enabled ?? true) && !!wsId && !!driveFileId,
    refetchOnWindowFocus: true,
    ...(opts?.retry !== undefined ? { retry: opts.retry } : {}),
  });
}

/**
 * Unlinks a Drive file reference from the workspace (`DELETE .../drive-files/{id}`).
 * Awaits the server (no optimistic update) and invalidates the workspace Drive prefix.
 */
export function useUnlinkDriveFile(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (driveFileId: string) => unlinkDriveFile(wsId, driveFileId),
    onSuccess: async (_ok, driveFileId) => {
      const detailKey = driveLibraryKeys.detail(wsId, driveFileId);
      await Promise.all([
        qc.invalidateQueries({
          queryKey: driveLibraryKeys.workspace(wsId),
          predicate: (q) =>
            !(
              q.queryKey.length === detailKey.length &&
              detailKey.every((k, i) => q.queryKey[i] === k)
            ),
        }),
        qc.invalidateQueries({ queryKey: detailKey, refetchType: "none" }),
      ]);
    },
  });
}

/**
 * Rebinds a Drive file reference to another connection (`POST .../drive-files/{id}/rebind`).
 * Awaits the server (no optimistic update) and invalidates the workspace Drive prefix.
 */
export function useRebindDriveFile(wsId: string, driveFileId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RebindDriveFileBody) => {
      const updated = await rebindDriveFile(wsId, driveFileId, body);
      if (!updated) {
        await qc.invalidateQueries({ queryKey: driveLibraryKeys.workspace(wsId) });
        throw new Error("drive file rebind not verifiable");
      }
      return updated;
    },
    onSuccess: (updated) => {
      qc.setQueryData(driveLibraryKeys.detail(wsId, driveFileId), updated);
      return qc.invalidateQueries({ queryKey: driveLibraryKeys.workspace(wsId) });
    },
  });
}

export interface AttachDriveFileToTaskVariables {
  driveFileId: string;
  connectionId: string;
  externalFileId: string;
  taskId: string;
}

/**
 * Links an existing Google Drive file reference to a task via
 * `POST /api/v1/workspaces/{wsId}/drive-files` (`{ connection_id, external_file_ids: [externalFileId], task_id }`).
 * Awaits the server (no optimistic update) and invalidates the drive-file detail,
 * the library list, that task's drive-files key, and the workspace Drive prefix.
 */
export function useAttachDriveFileToTask(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      connectionId,
      externalFileId,
      taskId,
    }: AttachDriveFileToTaskVariables): Promise<DriveFileLinkResults> =>
      linkDriveFiles(wsId, {
        connection_id: connectionId,
        external_file_ids: [externalFileId],
        task_id: taskId,
      }),
    onSuccess: async (_res, { driveFileId, taskId }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: driveLibraryKeys.detail(wsId, driveFileId) }),
        qc.invalidateQueries({ queryKey: driveLibraryKeys.lists(wsId) }),
        qc.invalidateQueries({ queryKey: driveLibraryKeys.task(wsId, taskId) }),
        qc.invalidateQueries({ queryKey: driveLibraryKeys.workspace(wsId) }),
      ]);
    },
  });
}
