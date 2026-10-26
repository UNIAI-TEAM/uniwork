"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkDriveTaskProposalDuplicates,
  createDriveTaskProposal,
  createTasksFromDriveProposal,
  deleteDriveTaskProposal,
  disconnectDriveConnection,
  getDrivePickerToken,
  getDriveTaskProposal,
  grantDriveFileAccess,
  isDriveConnectionLost,
  linkDriveFiles,
  listDriveConnections,
  listTaskDriveFiles,
  removeTaskDriveFile,
  startDriveConnect,
  type CheckDriveTaskProposalDuplicatesBody,
  type CreateDriveTaskProposalBody,
  type CreateTasksFromDriveProposalBody,
  type DriveConnection,
  type DriveConnectionList,
  type DriveDuplicateTask,
  type DriveFile,
  type DriveFileLinkItem,
  type DriveFileLinkReceipt,
  type DriveFileLinkResults,
  type DriveLinkedTaskRef,
  type DrivePickerToken,
  type DriveProposalCreatedTaskItem,
  type DriveProposalDuplicateItem,
  type DriveProposalExcerpt,
  type DriveProposalTaskItemInput,
  type DriveProposalTasksCreated,
  type DriveTaskCreationGroup,
  type DriveTaskFileCard,
  type DriveTaskProposal,
  type DriveTaskProposalItem,
  type DriveTasksCreatedSummary,
  type LinkDriveFilesBody,
} from "../api/endpoints/drive";
import { invalidateTaskCollections } from "../tasks/invalidate";
import { taskKeys } from "../tasks/keys";
import { driveKeys } from "./keys";

export {
  driveKeys,
  isDriveConnectionLost,
  type CheckDriveTaskProposalDuplicatesBody,
  type CreateDriveTaskProposalBody,
  type CreateTasksFromDriveProposalBody,
  type DriveConnection,
  type DriveConnectionList,
  type DriveDuplicateTask,
  type DriveFile,
  type DriveFileLinkItem,
  type DriveFileLinkReceipt,
  type DriveFileLinkResults,
  type DriveLinkedTaskRef,
  type DrivePickerToken,
  type DriveProposalCreatedTaskItem,
  type DriveProposalDuplicateItem,
  type DriveProposalExcerpt,
  type DriveProposalTaskItemInput,
  type DriveProposalTasksCreated,
  type DriveTaskCreationGroup,
  type DriveTaskFileCard,
  type DriveTaskProposal,
  type DriveTaskProposalItem,
  type DriveTasksCreatedSummary,
  type LinkDriveFilesBody,
};
/**
 * Lists the caller's Google Drive connections in the workspace's organization.
 * Drive queries enable `refetchOnWindowFocus` (spec §11) so returning from a
 * browser tab or popup refreshes connection state.
 */
export function useDriveConnections(wsId: string, options?: { enabled?: boolean }) {
  return useQuery<DriveConnectionList>({
    queryKey: driveKeys.connections(wsId),
    queryFn: () => listDriveConnections(wsId),
    enabled: (options?.enabled ?? true) && Boolean(wsId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Resolves the Google OAuth consent URL for a popup sign-in or reconnect.
 * The connection row updates after the callback (via popup outcome or
 * `drive_connection.changed`), so the cache is left untouched here.
 */
export function useStartDriveConnect(wsId: string) {
  return useMutation({
    mutationFn: (options?: { reconnect_connection_id?: string }) =>
      startDriveConnect(wsId, options),
  });
}

/**
 * Disconnects a Google Drive connection. Awaits the server response (no
 * optimistic removal) and invalidates all workspace Drive queries on success.
 */
export function useDisconnectDriveConnection(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => disconnectDriveConnection(wsId, connectionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: driveKeys.workspace(wsId) });
    },
  });
}

/**
 * Fetches a short-lived `drive.file` access token + developer key + app ID for
 * Google Picker (`POST .../drive-connections/{id}/picker-token`). Never cached
 * in QueryCache (spec §7.1, §12.4).
 */
export function useDrivePickerToken(wsId: string) {
  return useMutation({
    gcTime: 0,
    mutationFn: (connectionId: string) => getDrivePickerToken(wsId, connectionId),
  });
}

/**
 * Links 1..20 Google Drive files to the workspace (and optionally a task) in
 * one server call (`POST /workspaces/{ws}/drive-files`). Awaits the server
 * response (no optimistic update) and invalidates `driveKeys.workspace(wsId)`.
 */
export function useLinkDriveFiles(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LinkDriveFilesBody) => linkDriveFiles(wsId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: driveKeys.workspace(wsId) });
    },
  });
}

/**
 * Lists the Google Drive file cards attached to a task (`GET /tasks/{taskID}/drive-files`).
 * Keyed under `driveKeys.task(wsId, taskId)` so workspace-scoped Drive events
 * (`driveKeys.workspace(wsId)`) refresh open task cards automatically.
 */
export function useTaskDriveFiles(
  wsId: string,
  taskId: string,
  options?: { enabled?: boolean },
) {
  return useQuery<DriveTaskFileCard[]>({
    queryKey: driveKeys.task(wsId, taskId),
    queryFn: () => listTaskDriveFiles(taskId),
    enabled: (options?.enabled ?? true) && Boolean(wsId) && Boolean(taskId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Removes a Google Drive file reference from a task (`DELETE /tasks/{taskID}/drive-files/{driveFileID}`).
 * Awaits the server response (no optimistic removal) and invalidates both the
 * task's Drive files key and `driveKeys.workspace(wsId)`.
 */
export function useRemoveTaskDriveFile(wsId: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (driveFileId: string) => removeTaskDriveFile(taskId, driveFileId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: driveKeys.task(wsId, taskId) });
      void qc.invalidateQueries({ queryKey: driveKeys.workspace(wsId) });
    },
  });
}

/**
 * Grants `drive.file` read access for the caller after picking the file via
 * Google Picker `setFileIds` (`POST /workspaces/{ws}/drive-files/{driveFileID}/access`).
 * Awaits the server response and invalidates the task's Drive files key (when
 * provided) plus `driveKeys.workspace(wsId)`.
 */
export function useGrantDriveFileAccess(wsId: string, taskId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      driveFileId,
      connectionId,
    }: {
      driveFileId: string;
      connectionId: string;
    }) => {
      const file = await grantDriveFileAccess(wsId, driveFileId, connectionId);
      if (!file) throw new Error("drive_access_grant_response_invalid");
      return file;
    },
    onSuccess: () => {
      if (taskId) {
        void qc.invalidateQueries({ queryKey: driveKeys.task(wsId, taskId) });
      }
      void qc.invalidateQueries({ queryKey: driveKeys.workspace(wsId) });
    },
  });
}

/**
 * Reads a Google Drive file with the caller's connected account and creates an
 * AI task proposal batch (`POST /workspaces/{ws}/drive-files/{driveFileID}/task-proposals`,
 * Card B5, spec §8.2). Seeds `driveKeys.proposal(wsId, proposal.id)` on success.
 */
export function useCreateDriveTaskProposal(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      driveFileId,
      body,
      signal,
    }: {
      driveFileId: string;
      body?: CreateDriveTaskProposalBody;
      signal?: AbortSignal;
    }) => {
      const proposal = await createDriveTaskProposal(wsId, driveFileId, body, signal);
      if (!proposal) throw new Error("drive_task_proposal_response_invalid");
      return proposal;
    },
    onSuccess: (proposal) => {
      qc.setQueryData(driveKeys.proposal(wsId, proposal.id), proposal);
    },
  });
}

/**
 * Fetches a task proposal batch by ID (`GET /workspaces/{ws}/drive-task-proposals/{proposalID}`,
 * Card B5, spec §8.2a). Keyed under `driveKeys.proposal(wsId, proposalId)`.
 */
export function useDriveTaskProposal(
  wsId: string,
  proposalId: string,
  options?: { enabled?: boolean },
) {
  return useQuery<DriveTaskProposal | null>({
    queryKey: driveKeys.proposal(wsId, proposalId),
    queryFn: ({ signal }) => getDriveTaskProposal(wsId, proposalId, signal),
    enabled: (options?.enabled ?? true) && Boolean(wsId) && Boolean(proposalId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Discards a task proposal batch (`DELETE /workspaces/{ws}/drive-task-proposals/{proposalID}`,
 * Card B5, spec §8.4, §8.6). Awaits the server response and invalidates the
 * proposal query key on success.
 */
export function useDeleteDriveTaskProposal(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      proposalId,
      signal,
    }: {
      proposalId: string;
      signal?: AbortSignal;
    }) => deleteDriveTaskProposal(wsId, proposalId, signal),
    onSuccess: (_data, { proposalId }) => {
      void qc.invalidateQueries({ queryKey: driveKeys.proposal(wsId, proposalId) });
    },
  });
}

/**
 * Recomputes duplicate warnings for a proposal's item titles when the batch
 * project or parent task changes (`POST /workspaces/{ws}/drive-task-proposals/{proposalID}/duplicates`,
 * Card B5, spec §8.4).
 */
export function useCheckDriveTaskProposalDuplicates(wsId: string) {
  return useMutation({
    mutationFn: ({
      proposalId,
      body,
      signal,
    }: {
      proposalId: string;
      body: CheckDriveTaskProposalDuplicatesBody;
      signal?: AbortSignal;
    }) => checkDriveTaskProposalDuplicates(wsId, proposalId, body, signal),
  });
}

/**
 * Batch-creates confirmed tasks from a Drive task proposal (`POST /workspaces/{ws}/drive-task-proposals/{proposalID}/tasks`,
 * Card B6, spec §8.5). Awaits the server response (no optimistic create) and
 * invalidates task collections, parent task detail/subtasks when set, the
 * workspace Drive queries (`tasks_created`, file detail, task Drive cards),
 * and the proposal itself.
 */
export function useCreateTasksFromDriveProposal(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      proposalId,
      body,
      signal,
    }: {
      proposalId: string;
      body: CreateTasksFromDriveProposalBody;
      signal?: AbortSignal;
    }) => {
      const created = await createTasksFromDriveProposal(wsId, proposalId, body, signal);
      if (!created) throw new Error("drive_proposal_tasks_create_response_invalid");
      return created;
    },
    onSuccess: (_created, { proposalId, body }) => {
      void qc.invalidateQueries({ queryKey: driveKeys.proposal(wsId, proposalId) });
      void qc.invalidateQueries({ queryKey: driveKeys.workspace(wsId) });
      if (body.parent_task_id) {
        void qc.invalidateQueries({ queryKey: taskKeys.detail(body.parent_task_id) });
        void qc.invalidateQueries({ queryKey: taskKeys.children(body.parent_task_id) });
        void qc.invalidateQueries({ queryKey: taskKeys.childProgress(wsId) });
      }
      return invalidateTaskCollections(qc, wsId);
    },
  });
}
