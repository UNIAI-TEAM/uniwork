"use client";

import { useState, type Ref } from "react";
import { CircleAlert, Sparkles, TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { useTranslation } from "react-i18next";
import type { DriveTaskProposal } from "@uniwork/core/drive";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DialogDescription,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { cn } from "@uniwork/ui/lib/utils";
import {
  SheetDescription,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { AppLink } from "../../navigation";
import {
  CreateTaskParentField,
  CreateTaskProjectField,
} from "../pickers/create-task-project-fields";
import { StatusPicker } from "../pickers";
import { driveFileTypeLabel } from "./drive-proposal-helpers";

export interface DriveProposalReviewHeaderProps {
  isMobile: boolean;
  headingText: string;
  proposal: DriveTaskProposal | null;
  onRequestClose: () => void;
}

export function DriveProposalReviewHeader({
  isMobile,
  headingText,
  proposal,
  onRequestClose,
}: DriveProposalReviewHeaderProps) {
  const { t } = useTranslation();
  const typeLabel = driveFileTypeLabel(proposal?.drive_file_icon_kind, t);
  const readerEmail = proposal?.reader_account_email?.trim() ?? "";

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border px-6 py-4">
      <div className="flex items-center gap-2.5">
        <Sparkles className="size-5 shrink-0 text-primary" aria-hidden />
        {isMobile ? (
          <SheetTitle className="min-w-0 flex-1 break-words text-title font-semibold text-foreground">
            {headingText}
          </SheetTitle>
        ) : (
          <DialogTitle className="min-w-0 flex-1 break-words text-title font-semibold text-foreground">
            {headingText}
          </DialogTitle>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("drive.proposals.review.close_aria")}
          onClick={onRequestClose}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      {proposal ? (
        <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
          {isMobile ? (
            <SheetDescription className="text-caption text-muted-foreground">
              {readerEmail
                ? t("drive.proposals.review.source_line", {
                    name: proposal.drive_file_name,
                    type: typeLabel,
                    email: readerEmail,
                  })
                : t("drive.proposals.review.source_line_no_email", {
                    name: proposal.drive_file_name,
                    type: typeLabel,
                  })}
            </SheetDescription>
          ) : (
            <DialogDescription className="text-caption text-muted-foreground">
              {readerEmail
                ? t("drive.proposals.review.source_line", {
                    name: proposal.drive_file_name,
                    type: typeLabel,
                    email: readerEmail,
                  })
                : t("drive.proposals.review.source_line_no_email", {
                    name: proposal.drive_file_name,
                    type: typeLabel,
                  })}
            </DialogDescription>
          )}
          {proposal.sharing_state === "private" ? (
            <span
              data-testid="drive-proposal-private-badge"
              className="inline-flex items-center rounded-full bg-warning-soft px-2.5 py-0.5 text-caption font-semibold text-warning-soft-foreground"
            >
              {t("drive.proposals.review.private_badge")}
            </span>
          ) : null}
          {proposal.truncated ? (
            <span
              data-testid="drive-proposal-truncated-badge"
              className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-0.5 text-caption font-medium text-warning-soft-foreground"
            >
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              {t("drive.proposals.review.truncated_badge")}
            </span>
          ) : null}
        </div>
      ) : (
        <DialogDescription className="sr-only">
          {t("drive.proposals.review.loading")}
        </DialogDescription>
      )}
    </div>
  );
}

export interface DriveProposalBatchSectionProps {
  workspaceId: string;
  projectItems: Array<{ value: string; label: string }>;
  parentItems: Array<{ value: string; label: string }>;
  projectId: string | undefined;
  parentTaskId: string | undefined;
  statusKey: string;
  disabled: boolean;
  onProjectChange: (next: string | undefined) => void;
  onParentChange: (next: string | undefined) => void;
  onStatusChange: (next: string) => void;
  className?: string;
}

export function DriveProposalBatchSection({
  workspaceId,
  projectItems,
  parentItems,
  projectId,
  parentTaskId,
  statusKey,
  disabled,
  onProjectChange,
  onParentChange,
  onStatusChange,
  className,
}: DriveProposalBatchSectionProps) {
  const { t } = useTranslation();
  const [parentPickerOpen, setParentPickerOpen] = useState(false);

  return (
    <section
      aria-label={t("drive.proposals.review.batch_section")}
      className={cn(
        "flex shrink-0 flex-col gap-2.5 border-b border-border bg-muted/30 px-6 py-3.5",
        className,
      )}
    >
      <div className="text-caption font-semibold text-muted-foreground">
        {t("drive.proposals.review.batch_section")}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="text-caption text-muted-foreground">
            {t("drive.proposals.review.batch_project")}
          </span>
          <CreateTaskProjectField
            items={projectItems}
            value={projectId}
            noneLabel={t("tasks.create.project_none")}
            searchPlaceholder={t("tasks.create.project_search_placeholder")}
            noResultsLabel={t("tasks.create.options_no_results")}
            clearLabel={t("common.delete")}
            onChange={onProjectChange}
          />
          <span className="text-caption text-muted-foreground">
            {t("drive.proposals.review.batch_project_sub")}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-caption text-muted-foreground">
            {t("drive.proposals.review.batch_parent")}
          </span>
          <CreateTaskParentField
            items={parentItems}
            value={parentTaskId}
            ariaLabel={t("drive.proposals.review.batch_parent")}
            noneLabel={t("tasks.create.parent_none")}
            searchPlaceholder={t("tasks.create.parent_search_placeholder")}
            noResultsLabel={t("tasks.create.options_no_results")}
            clearLabel={t("common.delete")}
            open={parentPickerOpen}
            onOpenChange={setParentPickerOpen}
            onChange={onParentChange}
            onClear={() => onParentChange(undefined)}
          />
          <span className="text-caption text-muted-foreground">
            {t("drive.proposals.review.batch_parent_sub")}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-caption text-muted-foreground">
            {t("drive.proposals.review.batch_status")}
          </span>
          <StatusPicker
            workspaceId={workspaceId}
            value={statusKey}
            disabled={disabled}
            ariaLabel={t("drive.proposals.review.batch_status")}
            appearance="pill"
            searchPlaceholder={t("tasks.create.status_search_placeholder")}
            noResultsLabel={t("tasks.create.options_no_results")}
            onChange={onStatusChange}
          />
        </div>
      </div>
    </section>
  );
}

export interface DriveProposalPriorCreationsBannerProps {
  priorCreatedCount: number;
  priorCreationsHref: string | null;
}

export function DriveProposalPriorCreationsBanner({
  priorCreatedCount,
  priorCreationsHref,
}: DriveProposalPriorCreationsBannerProps) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      data-testid="drive-proposal-prior-creations"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning-soft-foreground/20 bg-warning-soft px-3.5 py-2.5 text-caption text-warning-soft-foreground"
    >
      <div className="flex items-center gap-2">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        <span>
          {t("drive.proposals.review.prior_creations", {
            count: priorCreatedCount,
          })}
        </span>
      </div>
      {priorCreationsHref ? (
        <AppLink
          href={priorCreationsHref}
          className="font-medium underline underline-offset-2 hover:opacity-80 pointer-coarse:min-h-11"
        >
          {t("drive.proposals.review.prior_creations_view")}
        </AppLink>
      ) : null}
    </div>
  );
}

export interface DriveProposalReviewFooterProps {
  selectedCount: number;
  isBusy: boolean;
  isCreating: boolean;
  createButtonLabel: string;
  errorMessage?: string | null;
  errorRef?: Ref<HTMLDivElement>;
  onCancel: () => void;
  onSubmit: () => void;
}

export function DriveProposalReviewFooter({
  selectedCount,
  isBusy,
  isCreating,
  createButtonLabel,
  errorMessage,
  errorRef,
  onCancel,
  onSubmit,
}: DriveProposalReviewFooterProps) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 flex-col gap-2.5 border-t border-border bg-muted/30 px-6 py-3.5">
      {errorMessage ? (
        <Alert
          variant="destructiveSoft"
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          data-testid="drive-proposal-create-error"
        >
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-60 flex-1 text-caption text-muted-foreground">
          {t("drive.proposals.review.footer_note")}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isBusy}
            className="min-h-11"
            onClick={onCancel}
          >
            {t("drive.proposals.review.cancel")}
          </Button>
          <Button
            type="button"
            data-testid="drive-proposal-submit"
            aria-disabled={selectedCount === 0 || isBusy || undefined}
            aria-busy={isCreating || undefined}
            className="min-h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={onSubmit}
          >
            {isCreating ? <Spinner className="size-4" /> : null}
            <span aria-live="polite">{createButtonLabel}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface DriveProposalDiscardAlertDialogProps {
  open: boolean;
  isDiscarding: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDiscard: () => void;
}

export function DriveProposalDiscardAlertDialog({
  open,
  isDiscarding,
  onOpenChange,
  onConfirmDiscard,
}: DriveProposalDiscardAlertDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isDiscarding) {
          onOpenChange(false);
        }
      }}
    >
      <AlertDialogContent nested>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("drive.proposals.review.discard_confirm_title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("drive.proposals.review.discard_confirm_description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDiscarding}>
            {t("drive.proposals.review.discard_confirm_keep")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isDiscarding}
            aria-busy={isDiscarding || undefined}
            onClick={onConfirmDiscard}
          >
            {isDiscarding
              ? t("drive.proposals.review.discarding")
              : t("drive.proposals.review.discard_confirm_discard")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface DriveProposalStatusViewProps {
  kind: "loading" | "error" | "converted" | "discarded" | "expired";
  errorMessage?: string;
  onClose: () => void;
}

export function DriveProposalStatusView({
  kind,
  errorMessage,
  onClose,
}: DriveProposalStatusViewProps) {
  const { t } = useTranslation();
  if (kind === "loading") {
    return (
      <div
        data-testid="drive-proposal-review-loading"
        className="flex flex-1 items-center justify-center gap-2 p-8 text-body text-muted-foreground"
      >
        <Spinner className="size-4" />
        <span>{t("drive.proposals.review.loading")}</span>
      </div>
    );
  }

  const text =
    kind === "error"
      ? errorMessage ?? t("drive.proposals.errors.create_default")
      : t(`drive.proposals.review.state_${kind}`);

  return (
    <div
      data-testid={kind === "error" ? "drive-proposal-state-error" : `drive-proposal-state-${kind}`}
      className="flex flex-1 flex-col gap-4 p-6"
    >
      <Alert variant="destructiveSoft" role="alert">
        <CircleAlert className="size-4 shrink-0" aria-hidden />
        <AlertDescription>{text}</AlertDescription>
      </Alert>
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={onClose}>
          {t("drive.proposals.review.close_aria")}
        </Button>
      </div>
    </div>
  );
}
