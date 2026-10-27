"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api";
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
import { apiErrorCopy } from "../../api-error-copy";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { toastApiError } from "../../toast-api-error";
import { useDriveConnectPopup } from "../use-drive-connect-popup";
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
  code: string | undefined,
  t: (key: string) => string,
  errorMessage?: string,
): string {
  switch (code) {
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

/**
 * Whether a `POST .../picker-token` failure means the Google Drive connection
 * itself has lost authorization (`auth_failed` / `drive_connection_lost` /
 * `needs_reconnect`, per contract §2 and R1-2 / R2-3). Network drops, 429/5xx,
 * non-connection 401/403 codes (such as `organization_suspended` or
 * `member_deactivated`), `feature_disabled`, and malformed 200 responses are
 * NOT connection-broken and leave the account usable.
 */
export function isPickerTokenConnectionBrokenError(err: unknown): boolean {
  const code = errorCode(err);
  return (
    code === "auth_failed" ||
    code === "drive_connection_lost" ||
    code === "needs_reconnect"
  );
}

function presentLinkOutcomeToasts(
  results: DriveFileLinkResults,
  pickedFiles: DrivePickedFile[],
  fallbackEmail: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): void {
  // Malformed / empty link response (or missing items for picked files):
  // never fail silently — report an error toast and treat missing files as
  // not linked (R1-7).
  if (results.results.length === 0 && pickedFiles.length > 0) {
    toast.error(t("errors.link_failed"));
    return;
  }

  const pickedNameById = new Map(pickedFiles.map((f) => [f.id, f.name]));
  let linkedCount = 0;
  const alreadyLinkedItems: Array<{ fileName: string; email: string }> = [];
  const seenFileIds = new Set<string>();

  for (const item of results.results) {
    seenFileIds.add(item.external_file_id);
    const fileName =
      item.file?.name ??
      pickedNameById.get(item.external_file_id) ??
      item.external_file_id;
    switch (item.outcome) {
      case "linked":
        linkedCount += 1;
        break;
      case "already_linked": {
        const email = (
          item.account_email ??
          item.file?.viewer_account_email ??
          fallbackEmail
        ).trim();
        alreadyLinkedItems.push({ fileName, email });
        break;
      }
      case "error": {
        const reason = driveLinkErrorReason(item.error_code, t, item.error_message);
        toast.error(
          fileName ? t("errors.file_error_named", { name: fileName, reason }) : reason,
        );
        break;
      }
      default:
        toast.error(
          fileName
            ? t("errors.file_error_named", {
                name: fileName,
                reason: t("errors.link_failed"),
              })
            : t("errors.link_failed"),
        );
        break;
    }
  }

  if (alreadyLinkedItems.length > 3) {
    const email = alreadyLinkedItems[0]?.email ?? "";
    toast.info(
      email
        ? t("outcomes.already_linked_many", { count: alreadyLinkedItems.length, email })
        : t("outcomes.already_linked_many_no_email", { count: alreadyLinkedItems.length }),
    );
  } else {
    for (const entry of alreadyLinkedItems) {
      if (entry.email) {
        toast.info(
          entry.fileName
            ? t("outcomes.already_linked_named", { name: entry.fileName, email: entry.email })
            : t("outcomes.already_linked", { email: entry.email }),
        );
      } else {
        toast.info(
          entry.fileName
            ? t("outcomes.already_linked_named_no_email", { name: entry.fileName })
            : t("outcomes.already_linked_no_email"),
        );
      }
    }
  }

  if (pickedFiles.some((file) => !seenFileIds.has(file.id))) {
    toast.error(t("errors.link_failed"));
  }
  if (linkedCount > 0) {
    toast.success(t("outcomes.linked", { count: linkedCount }));
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
  /**
   * Folder mode ("Name this folder"): the Picker is limited to folders and selects one, never links
   * and never asks the task confirmation; `onPicked` receives the picked folder (single pick).
   */
  folder?: boolean;
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
  /**
   * Fired after the user picks files (and confirms the Q6 dialog when
   * task-bound), both when `linkOnPick` is false (draft / custom caller) and
   * before `linkDriveFiles` when `linkOnPick` is true.
   */
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
  const workspace = useOptionalWorkspace()?.workspace;
  const connectionsQuery = useDriveConnections(wsId);
  const pickerTokenMutation = useDrivePickerToken(wsId);
  const linkFilesMutation = useLinkDriveFiles(wsId);

  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [pickerRunning, setPickerRunning] = useState(false);
  const [waitingForConnections, setWaitingForConnections] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingTaskConfirmation | null>(null);

  const activeRequestRef = useRef<DrivePickerOpenRequest>({});
  const busyRef = useRef(false);

  // Without a workspace context (a bare host) the slugs fall back the way the Drive list screen does.
  const reconnectHref = `${paths.workspace(workspace?.organization_slug || "org", workspace?.slug || wsId).settings()}?tab=integrations&connect=drive`;

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
        const match = connections.find((c) => c.id === remembered && !isDriveConnectionLost(c));
        if (match) return match.id;
      }
      const firstActive = connections.find((c) => !isDriveConnectionLost(c));
      return firstActive?.id ?? connections[0]?.id ?? null;
    },
    [storage, wsId],
  );

  const connectPopup = useDriveConnectPopup({
    wsId,
    onSettled: () => {
      void connectionsQuery.refetch().then((res) => {
        const refreshed = res.data?.connections;
        if (!refreshed || refreshed.length === 0) return;
        setSelectedConnectionId((prev) => {
          if (prev) {
            const existing = refreshed.find((c) => c.id === prev && !isDriveConnectionLost(c));
            if (existing) return existing.id;
          }
          return resolveDefaultConnectionId(refreshed);
        });
      });
    },
  });

  const handleLinkResults = useCallback(
    (results: DriveFileLinkResults, connectionId: string, pickedFiles: DrivePickedFile[]) => {
      const fallbackEmail =
        connectionsQuery.data?.connections.find((c) => c.id === connectionId)?.google_email ?? "";
      presentLinkOutcomeToasts(results, pickedFiles, fallbackEmail, t);
      onLinked?.(results, { connectionId, pickedFiles });
    },
    [connectionsQuery.data?.connections, onLinked, t],
  );

  const executeLinkOrCallback = useCallback(
    async (connectionId: string, files: DrivePickedFile[], linkOnPick: boolean) => {
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
      busyRef.current = true;
      setPickerRunning(true);

      let tokenData: DrivePickerToken | null = null;
      let tokenErr: unknown = null;
      try {
        tokenData = await pickerTokenMutation.mutateAsync(connectionId);
      } catch (err) {
        tokenErr = err;
        tokenData = null;
      }

      if (!tokenData) {
        busyRef.current = false;
        setPickerRunning(false);

        if (tokenErr !== null && isPickerTokenConnectionBrokenError(tokenErr)) {
          // Only a genuine connection-broken error refetches connections and
          // opens the account dialog for reconnect (R1-2).
          setSelectedConnectionId(connectionId);
          setAccountDialogOpen(true);
          toast.error(t("errors.token_failed"));
          void connectionsQuery.refetch();
          return;
        }

        const message =
          (tokenErr !== null ? apiErrorCopy(tokenErr) : undefined) ??
          t("errors.token_transient_failed");
        toast.error(message, {
          action: {
            label: t("errors.retry"),
            onClick: () => {
              void launchPickerForConnection(connectionId, req);
            },
          },
        });
        return;
      }

      rememberConnection(connectionId);
      setAccountDialogOpen(false);
      const resolvedAdapter = resolveDrivePickerAdapter(adapter);
      const result = await resolvedAdapter.open({
        token: tokenData.access_token,
        developerKey: tokenData.developer_key,
        appId: tokenData.app_id,
        locale: (i18n.resolvedLanguage ?? i18n.language ?? "vi").split("-")[0] || "vi",
        fileIds: req.fileIds,
        multiselect: req.folder ? false : (req.multiselect ?? true),
        title: t(req.folder ? "folder_title" : "title"),
        selectFolder: req.folder,
      });
      busyRef.current = false;
      setPickerRunning(false);

      if (result.status === "cancelled") return;
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

      const linkOnPick = req.folder ? false : (req.linkOnPick ?? true);
      const isTaskTarget = !req.folder && (forTask ?? Boolean(taskId));
      if (isTaskTarget && requiresTaskLinkConfirmation(files)) {
        setPendingConfirm({ connectionId, files, linkOnPick });
        return;
      }

      await executeLinkOrCallback(connectionId, files, linkOnPick);
    },
    [
      adapter,
      connectionsQuery,
      executeLinkOrCallback,
      forTask,
      i18n.language,
      i18n.resolvedLanguage,
      pickerTokenMutation,
      rememberConnection,
      t,
      taskId,
    ],
  );

  const openWithConnections = useCallback(
    (connections: DriveConnection[], request: DrivePickerOpenRequest) => {
      connectPopup.clearNotice();

      if (connections.length === 0) {
        // R1-4: never navigate away from a host dialog when no account is
        // connected — open the account step in place so the user can run the
        // W1 OAuth popup flow right here.
        setSelectedConnectionId(null);
        setAccountDialogOpen(true);
        return;
      }

      if (request.connectionId) {
        const target = connections.find((c) => c.id === request.connectionId);
        if (target && !isDriveConnectionLost(target)) {
          void launchPickerForConnection(target.id, request);
          return;
        }
        setSelectedConnectionId(target?.id ?? resolveDefaultConnectionId(connections));
        setAccountDialogOpen(true);
        return;
      }

      if (connections.length === 1) {
        const only = connections[0]!;
        if (!isDriveConnectionLost(only)) {
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
    [connectPopup, launchPickerForConnection, resolveDefaultConnectionId],
  );

  const open = useCallback(
    (request: DrivePickerOpenRequest = {}) => {
      if (
        busyRef.current ||
        pickerRunning ||
        waitingForConnections ||
        pickerTokenMutation.isPending ||
        linkFilesMutation.isPending
      ) {
        return;
      }
      activeRequestRef.current = request;
      if (connectionsQuery.data) {
        openWithConnections(connectionsQuery.data.connections, request);
        return;
      }

      // R1-3: wait while the connections list is loading; if it failed, show
      // an error toast with retry and never navigate away or claim 0 accounts.
      busyRef.current = true;
      setWaitingForConnections(true);
      const showConnectionsLoadError = () => {
        toast.error(t("errors.connections_load_failed"), {
          action: { label: t("errors.retry"), onClick: () => open(request) },
        });
      };
      void connectionsQuery
        .refetch()
        .then((res) => {
          busyRef.current = false;
          setWaitingForConnections(false);
          if (!res.data || res.isError) {
            showConnectionsLoadError();
            return;
          }
          openWithConnections(res.data.connections, request);
        })
        .catch(() => {
          busyRef.current = false;
          setWaitingForConnections(false);
          showConnectionsLoadError();
        });
    },
    [
      connectionsQuery,
      linkFilesMutation.isPending,
      openWithConnections,
      pickerRunning,
      pickerTokenMutation.isPending,
      t,
      waitingForConnections,
    ],
  );

  const connections = connectionsQuery.data?.connections ?? [];
  const pending =
    waitingForConnections || pickerRunning || pickerTokenMutation.isPending || linkFilesMutation.isPending;

  const dialogs: ReactNode = (
    <>
      <DrivePickerAccountDialog
        open={accountDialogOpen}
        onOpenChange={(nextOpen) => {
          setAccountDialogOpen(nextOpen);
          if (!nextOpen) connectPopup.clearNotice();
        }}
        connections={connections}
        selectedConnectionId={selectedConnectionId}
        onSelectConnection={(id) => setSelectedConnectionId(id)}
        isConnectionLost={isDriveConnectionLost}
        onReconnect={(conn) => connectPopup.connect(conn)}
        onConnectNew={() => connectPopup.connect()}
        onContinue={() => {
          if (!selectedConnectionId) return;
          void launchPickerForConnection(selectedConnectionId, activeRequestRef.current);
        }}
        submitting={pickerRunning || pickerTokenMutation.isPending}
        connectBusy={connectPopup.busy}
        popupPending={connectPopup.popupPending}
        onFocusPopup={connectPopup.focusPopup}
        connectNotice={connectPopup.notice}
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

  return { open, pending, dialogs, reconnectHref };
}
