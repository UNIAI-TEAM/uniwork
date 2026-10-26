"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  isDriveConnectionLost,
  useDriveConnections,
  useDrivePickerToken,
  useLinkDriveFiles,
  type DriveConnection,
  type DriveFileLinkResults,
  type DrivePickerToken,
} from "@uniwork/core/drive";
import { paths } from "@uniwork/core/paths";
import { defaultStorage } from "@uniwork/core/platform";
import type { StorageAdapter } from "@uniwork/core/types/storage";
import { useWorkspace } from "../../layout/workspace-context";
import { useNavigation } from "../../navigation";
import { toastApiError } from "../../toast-api-error";
import {
  resolveDrivePickerAdapter,
  type DrivePickedFile,
  type DrivePickerAdapter,
} from "./drive-picker-adapter";
import {
  DrivePickerAccountDialog,
  DrivePickerTaskConfirmDialog,
} from "./drive-picker-dialogs";

const LAST_CONNECTION_STORAGE_PREFIX = "uniwork:drive-picker:last-connection:";

export function drivePickerStorageKey(wsId: string): string {
  return `${LAST_CONNECTION_STORAGE_PREFIX}${wsId}`;
}

/**
 * Whether any picked file requires the task-linking confirmation dialog
 * (spec §7.1, Q6): shown when linking to a task and at least one picked file
 * has `sharingState !== "shared"`.
 */
export function requiresTaskLinkConfirmation(files: DrivePickedFile[]): boolean {
  return files.some((file) => file.sharingState !== "shared");
}

/**
 * Maps a per-file link error code (`sdo/drive_codes.go`, spec §5.7, §7.10) to
 * its localized sentence under `drive.picker.errors`.
 */
export function driveLinkErrorReason(
  errorCode: string | undefined,
  t: (key: string) => string,
  errorMessage?: string,
): string {
  switch (errorCode) {
    case "drive_grant_required":
      return t("errors.drive_grant_required");
    case "drive_file_not_accessible":
      return t("errors.drive_file_not_accessible");
    case "blocked_by_workspace_admin":
      return t("errors.blocked_by_workspace_admin");
    case "drive_unavailable":
      return t("errors.drive_unavailable");
    default:
      return errorMessage?.trim() ? errorMessage : t("errors.link_failed");
  }
}

export interface DrivePickerOpenRequest {
  connectionId?: string;
  fileIds?: string[];
  multiselect?: boolean;
  /**
   * When false (e.g. task creation draft in W4 where the task does not exist yet
   * or 2.4 second-viewer access grant where `/access` is called instead), skips
   * the `POST /workspaces/{ws}/drive-files` call after picking (and after the
   * task confirmation dialog when `forTask` is true) and invokes `onPicked`.
   * Defaults to true.
   */
  linkOnPick?: boolean;
}

export interface UseDrivePickerOptions {
  wsId: string;
  taskId?: string | null;
  /**
   * Treats the pick as task-bound even when `taskId` does not exist yet (e.g.
   * task creation dialog draft in W4), so the Q6 confirmation dialog still
   * protects non-shared filenames. Defaults to `Boolean(taskId)`.
   */
  forTask?: boolean;
  adapter?: DrivePickerAdapter;
  storage?: StorageAdapter;
  onLinked?: (
    results: DriveFileLinkResults,
    context: { connectionId: string; pickedFiles: DrivePickedFile[] },
  ) => void;
  onPicked?: (context: {
    connectionId: string;
    pickedFiles: DrivePickedFile[];
  }) => void;
}

export interface UseDrivePickerReturn {
  open: (request?: DrivePickerOpenRequest) => void;
  pending: boolean;
  dialogs: ReactNode;
  reconnectHref: string;
}

interface PendingTaskConfirmation {
  connectionId: string;
  files: DrivePickedFile[];
  linkOnPick: boolean;
}

export function useDrivePicker({
  wsId,
  taskId,
  forTask,
  adapter,
  storage = defaultStorage,
  onLinked,
  onPicked,
}: UseDrivePickerOptions): UseDrivePickerReturn {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "drive.picker" });
  const { workspace } = useWorkspace();
  const navigation = useNavigation();
  const connectionsQuery = useDriveConnections(wsId);
  const pickerTokenMutation = useDrivePickerToken(wsId);
  const linkFilesMutation = useLinkDriveFiles(wsId);

  const [locallyLostIds, setLocallyLostIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    null,
  );
  const [pickerRunning, setPickerRunning] = useState(false);
  const [pendingConfirm, setPendingConfirm] =
    useState<PendingTaskConfirmation | null>(null);

  const activeRequestRef = useRef<DrivePickerOpenRequest>({});

  const reconnectHref = `${paths.workspace(workspace.organization_slug, workspace.slug).settings()}?tab=integrations&connect=drive`;

  const isConnectionLost = useCallback(
    (conn: DriveConnection): boolean =>
      isDriveConnectionLost(conn) || locallyLostIds.has(conn.id),
    [locallyLostIds],
  );

  const markConnectionLost = useCallback(
    (connectionId: string) => {
      setLocallyLostIds((prev) => {
        if (prev.has(connectionId)) return prev;
        const next = new Set(prev);
        next.add(connectionId);
        return next;
      });
      void connectionsQuery.refetch();
    },
    [connectionsQuery],
  );

  const rememberConnection = useCallback(
    (connectionId: string) => {
      try {
        storage.setItem(drivePickerStorageKey(wsId), connectionId);
      } catch {
        // Ignore storage quota or unconfigured test environment errors.
      }
    },
    [storage, wsId],
  );

  const resolveDefaultConnectionId = useCallback(
    (connections: DriveConnection[]): string | null => {
      let remembered: string | null = null;
      try {
        remembered = storage.getItem(drivePickerStorageKey(wsId));
      } catch {
        remembered = null;
      }
      if (remembered) {
        const match = connections.find(
          (c) => c.id === remembered && !isConnectionLost(c),
        );
        if (match) return match.id;
      }
      const firstActive = connections.find((c) => !isConnectionLost(c));
      return firstActive?.id ?? connections[0]?.id ?? null;
    },
    [isConnectionLost, storage, wsId],
  );

  const handleLinkResults = useCallback(
    (
      results: DriveFileLinkResults,
      connectionId: string,
      pickedFiles: DrivePickedFile[],
    ) => {
      const pickedNameById = new Map(pickedFiles.map((f) => [f.id, f.name]));
      const fallbackEmail =
        connectionsQuery.data?.connections.find((c) => c.id === connectionId)
          ?.google_email ?? "";

      let linkedCount = 0;
      for (const item of results.results) {
        const fileName =
          item.file?.name ?? pickedNameById.get(item.external_file_id) ?? item.external_file_id;
        switch (item.outcome) {
          case "linked":
            linkedCount += 1;
            break;
          case "already_linked": {
            const email =
              item.account_email ?? item.file?.viewer_account_email ?? fallbackEmail;
            toast.info(
              fileName
                ? t("outcomes.already_linked_named", { name: fileName, email })
                : t("outcomes.already_linked", { email }),
            );
            break;
          }
          case "error": {
            const reason = driveLinkErrorReason(
              item.error_code,
              t,
              item.error_message,
            );
            toast.error(
              fileName
                ? t("errors.file_error_named", { name: fileName, reason })
                : reason,
            );
            break;
          }
          default:
            break;
        }
      }

      if (linkedCount > 0) {
        toast.success(t("outcomes.linked", { count: linkedCount }));
      }
      onLinked?.(results, { connectionId, pickedFiles });
    },
    [connectionsQuery.data?.connections, onLinked, t],
  );

  const executeLinkOrCallback = useCallback(
    async (
      connectionId: string,
      files: DrivePickedFile[],
      linkOnPick: boolean,
    ) => {
      onPicked?.({ connectionId, pickedFiles: files });
      if (!linkOnPick) {
        setPendingConfirm(null);
        return;
      }

      try {
        const res = await linkFilesMutation.mutateAsync({
          connection_id: connectionId,
          external_file_ids: files.map((f) => f.id),
          task_id: taskId ?? undefined,
        });
        setPendingConfirm(null);
        handleLinkResults(res, connectionId, files);
      } catch (err) {
        setPendingConfirm(null);
        toastApiError(err, t("errors.link_failed"));
      }
    },
    [handleLinkResults, linkFilesMutation, onPicked, t, taskId],
  );

  const launchPickerForConnection = useCallback(
    async (connectionId: string, req: DrivePickerOpenRequest) => {
      rememberConnection(connectionId);
      setPickerRunning(true);

      let tokenData: DrivePickerToken | null = null;
      try {
        tokenData = await pickerTokenMutation.mutateAsync(connectionId);
      } catch {
        tokenData = null;
      }

      if (!tokenData) {
        setPickerRunning(false);
        markConnectionLost(connectionId);
        setSelectedConnectionId(connectionId);
        setAccountDialogOpen(true);
        toast.error(t("errors.token_failed"));
        return;
      }

      setAccountDialogOpen(false);
      const resolvedAdapter = resolveDrivePickerAdapter(adapter);
      const result = await resolvedAdapter.open({
        token: tokenData.access_token,
        developerKey: tokenData.developer_key,
        appId: tokenData.app_id,
        locale: (i18n.resolvedLanguage ?? i18n.language ?? "vi").split("-")[0] || "vi",
        fileIds: req.fileIds,
        multiselect: req.multiselect ?? true,
        title: t("title"),
      });
      setPickerRunning(false);

      if (result.status === "cancelled") {
        return;
      }

      if (result.status === "error") {
        toast.error(t("errors.script_load_failed"), {
          action: {
            label: t("errors.retry"),
            onClick: () => {
              void launchPickerForConnection(connectionId, req);
            },
          },
        });
        return;
      }

      const files = result.files;
      if (files.length === 0) return;

      const linkOnPick = req.linkOnPick ?? true;
      const isTaskTarget = forTask ?? Boolean(taskId);
      if (isTaskTarget && requiresTaskLinkConfirmation(files)) {
        setPendingConfirm({ connectionId, files, linkOnPick });
        return;
      }

      await executeLinkOrCallback(connectionId, files, linkOnPick);
    },
    [
      adapter,
      executeLinkOrCallback,
      forTask,
      i18n.language,
      i18n.resolvedLanguage,
      markConnectionLost,
      pickerTokenMutation,
      rememberConnection,
      t,
      taskId,
    ],
  );

  const openWithConnections = useCallback(
    (connections: DriveConnection[], request: DrivePickerOpenRequest) => {
      if (connections.length === 0) {
        navigation.push(reconnectHref);
        return;
      }

      if (request.connectionId) {
        const target = connections.find((c) => c.id === request.connectionId);
        if (target && !isConnectionLost(target)) {
          void launchPickerForConnection(target.id, request);
          return;
        }
        setSelectedConnectionId(
          target?.id ?? resolveDefaultConnectionId(connections),
        );
        setAccountDialogOpen(true);
        return;
      }

      if (connections.length === 1) {
        const only = connections[0]!;
        if (!isConnectionLost(only)) {
          void launchPickerForConnection(only.id, request);
          return;
        }
        setSelectedConnectionId(only.id);
        setAccountDialogOpen(true);
        return;
      }

      setSelectedConnectionId(resolveDefaultConnectionId(connections));
      setAccountDialogOpen(true);
    },
    [
      isConnectionLost,
      launchPickerForConnection,
      navigation,
      reconnectHref,
      resolveDefaultConnectionId,
    ],
  );

  const open = useCallback(
    (request: DrivePickerOpenRequest = {}) => {
      activeRequestRef.current = request;
      if (connectionsQuery.data) {
        openWithConnections(connectionsQuery.data.connections, request);
        return;
      }
      void connectionsQuery.refetch().then((res) => {
        openWithConnections(res.data?.connections ?? [], request);
      });
    },
    [connectionsQuery, openWithConnections],
  );

  const handleReconnect = useCallback(() => {
    setAccountDialogOpen(false);
    navigation.push(reconnectHref);
  }, [navigation, reconnectHref]);

  const connections = connectionsQuery.data?.connections ?? [];
  const pending =
    pickerRunning ||
    pickerTokenMutation.isPending ||
    linkFilesMutation.isPending;

  const dialogs: ReactNode = (
    <>
      <DrivePickerAccountDialog
        open={accountDialogOpen}
        onOpenChange={setAccountDialogOpen}
        connections={connections}
        selectedConnectionId={selectedConnectionId}
        onSelectConnection={(id) => setSelectedConnectionId(id)}
        isConnectionLost={isConnectionLost}
        onReconnect={() => handleReconnect()}
        onContinue={() => {
          if (!selectedConnectionId) return;
          void launchPickerForConnection(
            selectedConnectionId,
            activeRequestRef.current,
          );
        }}
        submitting={pickerRunning || pickerTokenMutation.isPending}
      />
      <DrivePickerTaskConfirmDialog
        open={pendingConfirm !== null}
        fileCount={pendingConfirm?.files.length ?? 0}
        pending={linkFilesMutation.isPending}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          if (!pendingConfirm) return;
          void executeLinkOrCallback(
            pendingConfirm.connectionId,
            pendingConfirm.files,
            pendingConfirm.linkOnPick,
          );
        }}
      />
    </>
  );

  return {
    open,
    pending,
    dialogs,
    reconnectHref,
  };
}
