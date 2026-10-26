"use client";

import { useMemo } from "react";
import { CircleAlert, ExternalLink, FileX, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError, apiErrorMessage, errorCode } from "@uniwork/core/api";
import { useResourceHistory } from "@uniwork/core/audit";
import { useAuthStore } from "@uniwork/core/auth";
import { useDriveFile, useUnlinkDriveFile, type DriveFile, type DriveIconKind } from "@uniwork/core/drive-library";
import { paths } from "@uniwork/core/paths";
import { useMembers } from "@uniwork/core/workspaces";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { BreadcrumbHeader } from "../../layout/breadcrumb-header";
import { CollectionPageState } from "../../layout/collection-page";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { AppLink, useOptionalNavigation } from "../../navigation";
import { relativeTime } from "../../notifications/relative-time";
import { DocumentTypeIcon } from "../document-type-icon";
import { DocumentsGateState, useDocumentsGate } from "../documents-gate";
import { DriveAskUniHeaderButton, useDriveAskUniSeam } from "./drive-ask-uni-seam";
import {
  DriveFileActivitySection,
  DriveRebindSection,
  DriveUnlinkConfirmSection,
  DriveViewerAccessBlock,
} from "./drive-file-detail-sections";
import {
  useDriveLibraryConnections,
  type DriveConnectionSummary,
} from "./use-drive-library-connections";

export interface DriveFileDetailViewProps {
  wsId: string;
  driveFileId: string;
  /** Optional override for the caller's connected Google Drive accounts. */
  connections?: readonly DriveConnectionSummary[];
  /** Seam for W6 "Tạo việc từ tài liệu": rendered only when `file.can_propose` AND `onPropose` is passed. */
  onPropose?: (file: DriveFile) => void;
  /** Seam for W9 "Hỏi UNI": rendered only when `file.can_ask` AND `onAsk` is passed. */
  onAsk?: (file: DriveFile) => void;
  /** Seam for W3 Picker before calling `rebindDriveFile`. */
  onRebind?: (connectionId: string) => Promise<void> | void;
  /** Optional seam for W3 Picker `setFileIds` to grant read access ("Cho UniWork đọc tệp"). */
  onGrantAccess?: (file: DriveFile) => void;
  /** Optional seam to trigger reconnect popup directly. */
  onReconnect?: (connectionId: string) => void;
  /** Optional seam to attach the file to a task ("+ Gắn vào việc"). */
  onAttachToTask?: (file: DriveFile) => void;
}

function isDriveNotFoundError(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 404) return true;
  return errorCode(err) === "not_found";
}

function formatShortDate(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(d);
}

function driveTypeLabel(
  kind: DriveIconKind | string,
  t: (key: string) => string,
): string {
  switch (kind) {
    case "google_doc":
    case "google_sheet":
    case "google_slide":
    case "docx":
    case "xlsx":
    case "pptx":
    case "pdf":
    case "markdown":
    case "text":
      return t(`driveLibrary.file_types.${kind}`);
    default:
      return t("driveLibrary.file_types.generic");
  }
}


/**
 * 4.2 `/documents/drive/{driveFileId}` — Google Drive file reference detail page (spec §7.7, §7.8, §7.10, §7.11, §8.8).
 */
export function DriveFileDetailView({
  wsId,
  driveFileId,
  connections: connectionsProp,
  onPropose,
  onAsk,
  onRebind,
  onGrantAccess,
  onReconnect,
  onAttachToTask,
}: DriveFileDetailViewProps) {
  const { t, i18n } = useTranslation();
  const { gate, retry: retryGate } = useDocumentsGate();
  const enabled = gate === "on";
  const context = useOptionalWorkspace();
  const nav = useOptionalNavigation();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const { connections: defaultConnections } = useDriveLibraryConnections(wsId);
  const connections = connectionsProp ?? defaultConnections;

  const wsPaths = useMemo(
    () =>
      paths.workspace(
        context?.workspace.organization_slug || "org",
        context?.workspace.slug || wsId,
      ),
    [context?.workspace.organization_slug, context?.workspace.slug, wsId],
  );
  const driveLibraryHref = wsPaths.documentsDrive();
  const settingsIntegrationsHref = `${wsPaths.settings()}?tab=integrations`;

  const query = useDriveFile(wsId, driveFileId, {
    enabled,
    retry: (count, err) => !isDriveNotFoundError(err) && count < 1,
  });
  const file = query.data ?? null;

  const history = useResourceHistory(
    enabled && file ? wsId : "",
    "drive_file",
    enabled && file ? driveFileId : "",
  );
  const members = useMembers(enabled && file ? wsId : "");
  const memberNames = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.user_id, m.display_name])),
    [members.data],
  );
  const unlinkMutation = useUnlinkDriveFile(wsId);
  const { showAsk, askGranted, askDisabled, triggerAsk } = useDriveAskUniSeam({
    wsId,
    driveFileId,
    file,
    detailHref: wsPaths.documentsDriveFile(driveFileId),
    onPropose,
    onAsk,
  });

  if (gate !== "on") {
    return <DocumentsGateState gate={gate} retry={retryGate} className="mx-auto w-full max-w-3xl" />;
  }

  if (query.isPending) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 pt-8" aria-busy="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>
    );
  }

  if (query.error && isDriveNotFoundError(query.error)) {
    return (
      <CollectionPageState
        className="mx-auto w-full max-w-3xl"
        icon={FileX}
        title={t("driveLibrary.detail.not_found.title")}
        actions={
          <AppLink
            href={driveLibraryHref}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("driveLibrary.detail.not_found.back")}
          </AppLink>
        }
      />
    );
  }

  if (!file) {
    return (
      <CollectionPageState
        className="mx-auto w-full max-w-3xl"
        icon={CircleAlert}
        tone="destructive"
        role="alert"
        title={t("driveLibrary.detail.error.title")}
        description={t("driveLibrary.detail.error.description")}
        actions={
          <>
            <AppLink
              href={driveLibraryHref}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {t("driveLibrary.detail.not_found.back")}
            </AppLink>
            <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
              <RefreshCw aria-hidden className="size-3.5" />
              {t("driveLibrary.detail.error.retry")}
            </Button>
          </>
        }
      />
    );
  }

  const typeLabel = driveTypeLabel(file.icon_kind, t);
  const modifiedRelative = file.drive_modified_at
    ? relativeTime(file.drive_modified_at, i18n.language) ||
      formatShortDate(file.drive_modified_at, i18n.language)
    : "";
  const subtitleLine = modifiedRelative
    ? file.drive_modified_by_display
      ? t("driveLibrary.detail.modified_by_at", {
          type: typeLabel,
          name: file.drive_modified_by_display,
          time: modifiedRelative,
        })
      : t("driveLibrary.detail.modified_at", { type: typeLabel, time: modifiedRelative })
    : typeLabel;

  const isRebound = Boolean(file.bound_by_id && file.bound_by_id !== file.created_by);
  const linkedDate = formatShortDate(file.created_at, i18n.language);
  const linkedByLine =
    currentUserId && file.created_by === currentUserId
      ? t("driveLibrary.detail.props.linked_by_you", { date: linkedDate })
      : t("driveLibrary.detail.props.linked_by_other", {
          name: file.created_by_name,
          date: linkedDate,
        });

  const ownerDisplay =
    file.drive_id && !file.owner_display
      ? t("driveLibrary.detail.props.owner_shared_drive")
      : file.owner_display;

  const showPropose = file.can_propose && Boolean(onPropose);
  const usedInTotal = Math.max(file.used_in_count, file.used_in_tasks.length);
  const creations = (file.task_creations ?? []).filter((g) => g.tasks.length > 0);
  const totalCreatedCount = file.tasks_created?.count ?? 0;

  const handleUnlink = async (): Promise<boolean> => {
    try {
      await unlinkMutation.mutateAsync(file.id);
      if (nav?.push) {
        nav.push(driveLibraryHref);
      }
      return true;
    } catch (error) {
      const msg = error instanceof ApiError ? apiErrorMessage(error) : null;
      toast.error(msg ?? t("driveLibrary.detail.unlink.failed"));
      return false;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <BreadcrumbHeader
        segments={[
          {
            href: wsPaths.documents(),
            label: t("driveLibrary.detail.breadcrumb_documents"),
            className: "inline-flex shrink-0 items-center pointer-coarse:min-h-11",
          },
          {
            href: driveLibraryHref,
            label: t("driveLibrary.detail.breadcrumb_drive"),
            className: "inline-flex shrink-0 items-center pointer-coarse:min-h-11",
          },
        ]}
        leaf={<span title={file.name}>{file.name}</span>}
        className="h-auto min-h-12 py-1.5 sm:h-12 sm:py-0"
        actionsClassName="max-w-none flex-wrap justify-end gap-x-2 gap-y-1 overflow-visible"
        actions={
          <>
            <DriveAskUniHeaderButton
              showAsk={showAsk}
              askGranted={askGranted}
              askDisabled={askDisabled}
              onTriggerAsk={triggerAsk}
            />
            <a
              href={file.open_url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
            >
              <ExternalLink aria-hidden className="size-4" />
              {t("driveLibrary.detail.open_on_drive")}
            </a>
          </>
        }
      />

      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-start gap-6 px-4 py-6 sm:px-6">
        <section
          aria-label={t("driveLibrary.detail.section_file")}
          className="flex min-w-0 flex-[999_1_32rem] flex-col gap-5 rounded-xl border border-border bg-background p-6"
        >
          <div className="flex flex-wrap items-center gap-4">
            <DocumentTypeIcon format={file.icon_kind} className="size-11 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h1 title={file.name} className="truncate text-title font-semibold text-foreground">
                {file.name}
              </h1>
              <p className="text-caption text-muted-foreground">{subtitleLine}</p>
            </div>
          </div>

          <div>
            <a
              href={file.open_url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ size: "default" }), "gap-2")}
            >
              <ExternalLink aria-hidden className="size-4" />
              {t("driveLibrary.detail.open_on_drive")}
            </a>
          </div>

          <p className="text-caption text-muted-foreground">
            {file.viewer_account_email
              ? t("driveLibrary.detail.explainer", { email: file.viewer_account_email })
              : t("driveLibrary.detail.explainer_no_account")}
          </p>

          {showPropose && onPropose ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={() => onPropose(file)}>
                <Sparkles aria-hidden className="size-4" />
                {t("driveLibrary.detail.propose_tasks")}
              </Button>
            </div>
          ) : null}

          {creations.length > 0 || totalCreatedCount > 0 ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-body font-semibold text-foreground">
                  {t("driveLibrary.detail.tasks_created.title")}
                </h2>
                {totalCreatedCount > 0 ? (
                  <span className="text-caption text-muted-foreground">
                    {t("driveLibrary.detail.tasks_created.summary", { count: totalCreatedCount })}
                  </span>
                ) : null}
              </div>
              {creations.map((group) => (
                <div key={group.proposal_id} className="flex flex-col gap-1.5">
                  <div className="text-caption font-medium text-muted-foreground">
                    {t("driveLibrary.detail.tasks_created.group", {
                      date: formatShortDate(group.created_at, i18n.language),
                      name: group.created_by_name,
                      count: group.tasks.length,
                    })}
                  </div>
                  <ul className="flex flex-col gap-1">
                    {group.tasks.map((task) => (
                      <li key={task.task_id}>
                        <AppLink
                          href={wsPaths.task(task.task_id)}
                          className="inline-flex min-h-8 items-center text-body text-foreground hover:underline pointer-coarse:min-h-11"
                        >
                          {t("driveLibrary.detail.used_in.task_row", {
                            identifier: task.identifier,
                            title: task.title,
                          })}
                        </AppLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <aside
          aria-label={t("driveLibrary.detail.section_meta")}
          className="flex flex-[1_1_20rem] flex-col gap-4"
        >
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-5 text-body">
            <div className="flex flex-col gap-1">
              <span className="text-caption text-muted-foreground">
                {t("driveLibrary.detail.props.source")}
              </span>
              <span className="font-medium text-foreground">
                {t("driveLibrary.detail.props.source_value", { type: typeLabel })}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-caption text-muted-foreground">
                {t("driveLibrary.detail.props.bound_account")}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-foreground">{file.bound_account_email}</span>
                {isRebound ? (
                  <span className="text-caption text-muted-foreground">
                    {t("driveLibrary.detail.props.rebound_by", { name: file.bound_by_name })}
                  </span>
                ) : null}
              </div>
              {file.bound_connection_lost ? (
                <span className="inline-flex items-center gap-1 text-caption text-warning">
                  <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                  <span>{t("driveLibrary.detail.props.bound_connection_lost")}</span>
                </span>
              ) : null}
              {file.access_lost_at && file.viewer_access !== "lost" ? (
                <span className="inline-flex items-center gap-1 text-caption text-warning">
                  <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                  <span>{t("driveLibrary.detail.props.bound_access_lost")}</span>
                </span>
              ) : null}
              <DriveRebindSection
                wsId={wsId}
                file={file}
                connections={connections}
                onRebind={onRebind}
              />
            </div>

            {file.viewer_access === "granted" ? (
              <div className="flex flex-col gap-1">
                <span className="text-caption text-muted-foreground">
                  {t("driveLibrary.detail.props.viewer_account")}
                </span>
                <span className="font-medium text-foreground">
                  {file.viewer_account_email || t("driveLibrary.list.no_account_value")}
                </span>
                <span className="text-caption text-muted-foreground">
                  {t("driveLibrary.detail.props.viewer_account_hint")}
                </span>
              </div>
            ) : (
              <DriveViewerAccessBlock
                file={file}
                settingsIntegrationsHref={settingsIntegrationsHref}
                onGrantAccess={onGrantAccess ? () => onGrantAccess(file) : undefined}
                onReconnect={onReconnect}
              />
            )}

            <div className="flex flex-col gap-1">
              <span className="text-caption text-muted-foreground">
                {t("driveLibrary.detail.props.owner")}
              </span>
              <span className="font-medium text-foreground">{ownerDisplay}</span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-caption text-muted-foreground">
                {t("driveLibrary.detail.props.linked_by")}
              </span>
              <span className="font-medium text-foreground">{linkedByLine}</span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-caption text-muted-foreground">
                {t("driveLibrary.detail.props.permissions")}
              </span>
              <span className="font-medium text-foreground">
                {t("driveLibrary.detail.props.permissions_value")}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-background p-5 text-body">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-foreground">
                {t("driveLibrary.detail.used_in.title", { count: usedInTotal })}
              </h2>
              {onAttachToTask ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onAttachToTask(file)}
                >
                  {t("driveLibrary.detail.used_in.attach_to_task")}
                </Button>
              ) : null}
            </div>
            {file.used_in_tasks.length === 0 ? (
              <p className="text-caption text-muted-foreground">
                {t("driveLibrary.detail.used_in.empty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {file.used_in_tasks.map((task) => (
                  <li key={task.task_id}>
                    <AppLink
                      href={wsPaths.task(task.task_id)}
                      className="inline-flex min-h-8 items-center text-body text-foreground hover:underline pointer-coarse:min-h-11"
                    >
                      {t("driveLibrary.detail.used_in.task_row", {
                        identifier: task.identifier,
                        title: task.title,
                      })}
                    </AppLink>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DriveFileActivitySection
            events={history.data ?? []}
            isPending={history.isPending}
            isError={history.isError}
            currentUserId={currentUserId}
            memberNames={memberNames}
          />

          {file.can_unlink ? (
            <DriveUnlinkConfirmSection
              usedInCount={usedInTotal}
              pending={unlinkMutation.isPending}
              onConfirm={handleUnlink}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
