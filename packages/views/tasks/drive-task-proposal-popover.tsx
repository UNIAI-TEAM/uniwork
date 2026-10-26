"use client";

import { useState, type ReactNode } from "react";
import { CircleAlert, ExternalLink, Sparkles, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError, errorCode } from "@uniwork/core/api";
import { useCreateDriveTaskProposal, type DriveTaskProposal, type DriveTasksCreatedSummary } from "@uniwork/core/drive";
import { paths } from "@uniwork/core/paths";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { shortDateFormat } from "../common/date-pill";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";

export interface DriveProposalReviewStepTarget {
  proposalId: string;
  proposal: DriveTaskProposal;
}

type DriveProposalReviewSeamHandler = (target: DriveProposalReviewStepTarget) => void;

let registeredReviewSeamHandler: DriveProposalReviewSeamHandler | null = null;

/**
 * Seam for W7 (`packages/views/tasks/drive-proposals/`): registers a global
 * review-dialog opener, or pass `onProposalReady` directly to the panel/popover.
 * When unset, opening the review step is a clean no-op stub.
 */
export function registerDriveProposalReviewSeam(
  handler: DriveProposalReviewSeamHandler | null,
): void {
  registeredReviewSeamHandler = handler;
}

export function handOffDriveProposalToReview(
  target: DriveProposalReviewStepTarget,
  onProposalReady?: (proposalId: string, proposal: DriveTaskProposal) => void,
): void {
  if (onProposalReady) {
    onProposalReady(target.proposalId, target.proposal);
    return;
  }
  registeredReviewSeamHandler?.(target);
}

export function formatProposalShortDate(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, shortDateFormat(String(date.getFullYear())));
}

export interface DriveProposalErrorResolution {
  code: string;
  message: string;
  isFormatUnsupported: boolean;
  isAccessRequired: boolean;
}

/**
 * Maps an error from `POST .../drive-files/{id}/task-proposals` (or `POST .../drive-files`)
 * to its localized sentence under `drive.proposals.errors` (spec §7.10, §8.2, `sdo/drive_codes.go`).
 */
export function resolveDriveProposalError(
  error: unknown,
  t: (key: string) => string,
): DriveProposalErrorResolution {
  const code = errorCode(error);
  const status = error instanceof ApiError ? error.status : undefined;

  if (status === 429 || code === "rate_limited" || code === "ai_rate_limited") {
    return { code: code ?? "rate_limited", message: t("drive.proposals.errors.rate_limited"), isFormatUnsupported: false, isAccessRequired: false };
  }

  switch (code) {
    case "drive_access_required":
      return { code, message: t("drive.proposals.errors.drive_access_required"), isFormatUnsupported: false, isAccessRequired: true };
    case "drive_grant_required":
      return { code, message: t("drive.proposals.errors.drive_grant_required"), isFormatUnsupported: false, isAccessRequired: true };
    case "drive_format_unsupported":
      return { code, message: t("drive.proposals.errors.drive_format_unsupported"), isFormatUnsupported: true, isAccessRequired: false };
    case "ai_disabled":
    case "feature_disabled":
      return { code, message: t("drive.proposals.errors.ai_disabled"), isFormatUnsupported: false, isAccessRequired: false };
    case "ai_quota_exceeded":
    case "ai_provider_error":
    case "ai_provider_timeout":
    case "ai_output_invalid":
    case "drive_source_changed":
    case "drive_file_not_accessible":
    case "drive_unavailable":
    case "drive_extract_unavailable":
    case "auth_failed":
    case "blocked_by_workspace_admin":
    case "not_found":
      return { code, message: t(`drive.proposals.errors.${code}`), isFormatUnsupported: false, isAccessRequired: false };
    default:
      return { code: code ?? "default", message: t("drive.proposals.errors.default"), isFormatUnsupported: false, isAccessRequired: false };
  }
}

export interface DriveRecreateWarningProps {
  id: string;
  tasksCreated: DriveTasksCreatedSummary | undefined;
  detailHref?: string;
  onViewCreatedTasks?: () => void;
}

/**
 * Re-creation warning banner (spec §8.8): shown when `tasks_created.count > 0`.
 * Never blocks sending; carries `role="status"` and is referenced by the send
 * button via `aria-describedby`.
 */
export function DriveRecreateWarning({
  id,
  tasksCreated,
  detailHref,
  onViewCreatedTasks,
}: DriveRecreateWarningProps) {
  const { t, i18n } = useTranslation();
  const count = tasksCreated?.count ?? 0;
  if (count <= 0) return null;

  const locale = i18n.resolvedLanguage ?? i18n.language ?? "vi";
  const date = formatProposalShortDate(tasksCreated?.last_created_at, locale);
  const name = tasksCreated?.last_created_by_name?.trim() ?? "";

  let sentence: string;
  if (date && name) {
    sentence = t("drive.proposals.recreate_warning.full", { count, date, name });
  } else if (date) {
    sentence = t("drive.proposals.recreate_warning.with_date", { count, date });
  } else if (name) {
    sentence = t("drive.proposals.recreate_warning.with_name", { count, name });
  } else {
    sentence = t("drive.proposals.recreate_warning.count_only", { count });
  }

  return (
    <div
      id={id}
      role="status"
      data-testid="drive-recreate-warning"
      className="flex flex-col gap-1.5 rounded-lg border border-warning-soft-foreground/20 bg-warning-soft px-3 py-2.5 text-caption text-warning-soft-foreground"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{sentence}</span>
      </div>
      {detailHref || onViewCreatedTasks ? (
        <div className="pl-6">
          {onViewCreatedTasks ? (
            <button
              type="button"
              onClick={onViewCreatedTasks}
              className="inline-flex items-center font-medium text-warning-soft-foreground underline underline-offset-2 hover:opacity-80 pointer-coarse:min-h-11"
            >
              {t("drive.proposals.recreate_warning.view_created")}
            </button>
          ) : detailHref ? (
            <AppLink
              href={detailHref}
              className="inline-flex items-center font-medium text-warning-soft-foreground underline underline-offset-2 hover:opacity-80 pointer-coarse:min-h-11"
            >
              {t("drive.proposals.recreate_warning.view_created")}
            </AppLink>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface DriveProposalErrorNoticeProps {
  error: DriveProposalErrorResolution | null;
  openUrl?: string;
}

export function DriveProposalErrorNotice({
  error,
  openUrl,
}: DriveProposalErrorNoticeProps) {
  const { t } = useTranslation();
  if (!error) return null;

  return (
    <Alert
      variant="destructiveSoft"
      role="alert"
      data-testid="drive-proposal-error"
    >
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-caption">
        <span>{error.message}</span>
        {error.isFormatUnsupported && openUrl ? (
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:opacity-80 pointer-coarse:min-h-11"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            {t("drive.proposals.open_on_drive")}
          </a>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export interface DriveProposeTasksPopoverProps {
  workspaceId: string;
  driveFileId: string;
  readerAccountEmail?: string;
  openUrl?: string;
  tasksCreated?: DriveTasksCreatedSummary;
  contextTaskId?: string | null;
  projectId?: string | null;
  parentTaskId?: string | null;
  detailHref?: string;
  onViewCreatedTasks?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onProposalReady?: (proposalId: string, proposal: DriveTaskProposal) => void;
  onAccessRequired?: () => void;
  trigger?: ReactNode;
  align?: "start" | "center" | "end";
}

/**
 * Popover "Tạo việc từ tài liệu" (spec §8.1, §8.2, §8.8) used on the task Drive card
 * and 4.2 Drive detail page (including `?propose=1` deep link).
 */
export function DriveProposeTasksPopover({
  workspaceId,
  driveFileId,
  readerAccountEmail,
  openUrl,
  tasksCreated,
  contextTaskId,
  projectId,
  parentTaskId,
  detailHref: detailHrefProp,
  onViewCreatedTasks,
  open: openProp,
  onOpenChange,
  onProposalReady,
  onAccessRequired,
  trigger,
  align = "start",
}: DriveProposeTasksPopoverProps) {
  const { t } = useTranslation();
  const workspaceContext = useOptionalWorkspace();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const [prompt, setPrompt] = useState("");
  const [errorState, setErrorState] = useState<DriveProposalErrorResolution | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const proposeMutation = useCreateDriveTaskProposal(workspaceId);
  const isReading = abortController !== null && proposeMutation.isPending;

  const defaultDetailHref = workspaceContext
    ? `${paths
        .workspace(workspaceContext.workspace.organization_slug, workspaceContext.workspace.slug)
        .documentsDriveFile(driveFileId)}#drive-tasks-created`
    : undefined;
  const detailHref = detailHrefProp ?? defaultDetailHref;

  const hasPriorTasks = (tasksCreated?.count ?? 0) > 0;
  const warningId = `drive-propose-warning-${driveFileId}`;
  const promptInputId = `drive-propose-prompt-${driveFileId}`;
  const trimmedEmail = readerAccountEmail?.trim() ?? "";

  const handleCancelReading = () => {
    abortController?.abort();
    setAbortController(null);
    proposeMutation.reset();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isReading) {
      handleCancelReading();
    }
    if (!nextOpen) {
      setErrorState(null);
    }
    setOpen(nextOpen);
  };

  const handleSubmit = async () => {
    if (isReading) return;
    setErrorState(null);
    const controller = new AbortController();
    setAbortController(controller);

    try {
      const proposal = await proposeMutation.mutateAsync({
        driveFileId,
        body: {
          prompt: prompt.trim() || undefined,
          project_id: projectId,
          parent_task_id: parentTaskId ?? contextTaskId,
          context_task_id: contextTaskId,
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setAbortController(null);
      setPrompt("");
      setOpen(false);
      handOffDriveProposalToReview(
        { proposalId: proposal.id, proposal },
        onProposalReady,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setAbortController(null);
      const resolved = resolveDriveProposalError(err, t);
      setErrorState(resolved);
      if (resolved.isAccessRequired) {
        onAccessRequired?.();
      }
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          (trigger as React.ReactElement) ?? (
            <Button type="button" variant="outline" size="sm">
              <Sparkles className="size-3.5" aria-hidden />
              {t("drive.proposals.propose_button")}
            </Button>
          )
        }
      />
      <PopoverContent align={align} className="w-96 max-w-[calc(100vw-2rem)] gap-3 p-4">
        <PopoverHeader className="gap-1">
          <PopoverTitle className="text-body font-semibold text-foreground">
            {t("drive.proposals.popover_title")}
          </PopoverTitle>
          <PopoverDescription className="text-caption text-muted-foreground">
            {trimmedEmail
              ? t("drive.proposals.reader_line", { email: trimmedEmail })
              : t("drive.proposals.reader_line_no_email")}
          </PopoverDescription>
        </PopoverHeader>

        <DriveRecreateWarning
          id={warningId}
          tasksCreated={tasksCreated}
          detailHref={detailHref}
          onViewCreatedTasks={
            onViewCreatedTasks
              ? () => {
                  setOpen(false);
                  onViewCreatedTasks();
                }
              : undefined
          }
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={promptInputId}
            className="text-caption font-medium text-foreground"
          >
            {t("drive.proposals.prompt_label")}
          </label>
          <Textarea
            id={promptInputId}
            rows={3}
            maxLength={2000}
            disabled={isReading}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("drive.proposals.prompt_placeholder")}
            className="min-h-20 resize-y text-body"
          />
        </div>

        <DriveProposalErrorNotice error={errorState} openUrl={openUrl} />

        <div className="flex items-center justify-end gap-2 pt-1">
          {isReading ? (
            <>
              <div
                aria-live="polite"
                className="mr-auto inline-flex items-center gap-2 text-caption text-muted-foreground"
              >
                <Spinner className="size-3.5" />
                <span>{t("drive.proposals.reading")}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancelReading}
              >
                {t("drive.proposals.cancel_reading")}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              aria-describedby={hasPriorTasks ? warningId : undefined}
              onClick={() => void handleSubmit()}
            >
              <Sparkles className="size-3.5" aria-hidden />
              {hasPriorTasks
                ? t("drive.proposals.submit_anyway")
                : t("drive.proposals.submit")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
