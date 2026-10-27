"use client";

import { useMemo, useState } from "react";
import { CalendarClock, CalendarDays, ChevronDown, ChevronUp, Tags, TriangleAlert, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskLabel, TaskPriority } from "@uniwork/core/types";
import { Avatar, AvatarFallback, AvatarImage } from "@uniwork/ui/components/ui/avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../../common/date-field";
import { PillButton } from "../../common/pill-button";
import { AppLink } from "../../navigation";
import {
  AssigneePicker,
  LabelPicker,
  PriorityPicker,
  labelChipClass,
  type AssigneeOption,
} from "../pickers";
import {
  formatDriveProposalQuoteSourceLine,
  formatDriveProposalSourceLine,
  formatDriveProposalSummaryLine,
  type DriveProposalItemDraft,
  type DuplicateDecision,
} from "./drive-proposal-helpers";

export interface DriveProposalItemCardProps {
  draft: DriveProposalItemDraft;
  fileName: string;
  fileHref: string | null;
  blockedByTitles: readonly string[];
  assigneeOptions: AssigneeOption[];
  labels: TaskLabel[];
  taskHref: (taskId: string) => string | null;
  disabled?: boolean;
  onUpdate: (patch: Partial<DriveProposalItemDraft>) => void;
  onDuplicateDecision: (decision: DuplicateDecision) => void;
}

function BasisLine({ basis }: { basis: string | undefined }) {
  const { t } = useTranslation();
  const trimmed = basis?.trim();
  if (!trimmed) return null;
  return (
    <span
      data-testid="drive-proposal-basis"
      className="text-caption text-warning"
    >
      {t("drive.proposals.review.basis_line", { basis: trimmed })}
    </span>
  );
}

export function DriveProposalItemCard({
  draft,
  fileName,
  fileHref,
  blockedByTitles,
  assigneeOptions,
  labels,
  taskHref,
  disabled = false,
  onUpdate,
  onDuplicateDecision,
}: DriveProposalItemCardProps) {
  const { t } = useTranslation();
  const [descOpen, setDescOpen] = useState(false);

  const isIncluded = draft.selected && draft.duplicateDecision !== "skip";
  const selectedLabelIds = useMemo(() => new Set(draft.labelIds), [draft.labelIds]);
  const selectedLabels = useMemo(
    () => labels.filter((l) => selectedLabelIds.has(l.id)),
    [labels, selectedLabelIds],
  );
  const labelSummary = useMemo(
    () => selectedLabels.map((l) => l.name).join(", "),
    [selectedLabels],
  );

  const assigneeRef = draft.assigneeId
    ? { id: draft.assigneeId, kind: "human" as const }
    : null;
  const assigneeOption = draft.assigneeId
    ? assigneeOptions.find((o) => o.id === draft.assigneeId)
    : undefined;
  const assigneeName = assigneeOption?.name;

  const needsDriveAccessNotice =
    isIncluded &&
    Boolean(draft.assigneeId) &&
    draft.assigneeDriveAccess === "unknown" &&
    Boolean(assigneeName);

  const duplicate = draft.possibleDuplicate;
  const duplicateHref = duplicate ? taskHref(duplicate.task_id) : null;

  const handleToggleSwitch = (checked: boolean) => {
    if (disabled) return;
    if (checked && draft.duplicateDecision === "skip") {
      onUpdate({ selected: true, duplicateDecision: "keep" });
      return;
    }
    onUpdate({ selected: checked });
  };

  const handleToggleLabel = (labelId: string, checked: boolean) => {
    const next = checked
      ? draft.labelIds.includes(labelId)
        ? draft.labelIds
        : [...draft.labelIds, labelId]
      : draft.labelIds.filter((id) => id !== labelId);
    onUpdate({ labelIds: next });
  };

  const handleChecklistTextChange = (value: string) => {
    const next = value
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*☐✓]|\[\s?[xX]?\])\s*/, ""));
    onUpdate({ checklist: next });
  };

  const sourceLineText = formatDriveProposalSourceLine(
    draft.excerpt,
    fileName,
    null,
    t,
  );

  const summaryParts = formatDriveProposalSummaryLine(
    draft.goal,
    draft.checklist,
    t,
  );
  const quoteSourceParts = formatDriveProposalQuoteSourceLine(
    draft.excerpt,
    fileName,
    t,
  );
  const itemNumber = draft.index + 1;

  return (
    <div
      data-testid={`drive-proposal-item-${draft.index}`}
      data-selected={String(isIncluded)}
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-3.5 transition-colors",
        isIncluded
          ? "border-primary/30 bg-primary/5"
          : "border-border bg-background opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
          <Switch
            checked={isIncluded}
            disabled={disabled}
            onCheckedChange={handleToggleSwitch}
            className="after:-inset-x-3 after:-inset-y-4 pointer-coarse:after:-inset-y-4"
            aria-label={t("drive.proposals.review.item_switch_aria", {
              title: draft.title.trim() || t("drive.proposals.review.item_title_placeholder"),
            })}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={draft.title}
              disabled={disabled}
              aria-label={t("drive.proposals.review.item_title_aria", { index: itemNumber })}
              placeholder={t("drive.proposals.review.item_title_placeholder")}
              onChange={(e) => onUpdate({ title: e.target.value })}
              className="min-h-11 flex-1 basis-64 bg-background font-semibold"
            />
            {blockedByTitles.length > 0 ? (
              <span
                data-testid={`drive-proposal-blocked-by-${draft.index}`}
                className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-1 text-caption text-foreground"
              >
                {t("drive.proposals.review.blocked_by", {
                  titles: blockedByTitles.join(", "),
                })}
              </span>
            ) : null}
          </div>
          {summaryParts || quoteSourceParts ? (
            <div className="flex min-w-0 flex-col gap-0.5">
              {summaryParts ? (
                <p
                  data-testid={`drive-proposal-summary-${draft.index}`}
                  title={summaryParts.fullText}
                  className="flex min-w-0 items-center whitespace-pre text-caption text-muted-foreground"
                >
                  {summaryParts.goalPart ? (
                    <span className="min-w-0 truncate">{summaryParts.goalPart}</span>
                  ) : null}
                  {summaryParts.tailPart ? (
                    <span className="shrink-0">{summaryParts.tailPart}</span>
                  ) : null}
                </p>
              ) : null}
              {quoteSourceParts ? (
                <p
                  data-testid={`drive-proposal-quote-source-${draft.index}`}
                  title={quoteSourceParts.fullText}
                  className="flex min-w-0 items-center whitespace-pre text-caption text-muted-foreground"
                >
                  <span className="min-w-0 truncate">{quoteSourceParts.quotePart}</span>
                  {quoteSourceParts.fileTailPart ? (
                    <span className="max-w-[50%] shrink-0 overflow-hidden text-ellipsis whitespace-pre">
                      {quoteSourceParts.fileTailPart}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-caption text-muted-foreground">{t("tasks.assignee")}</span>
              <AssigneePicker
                value={assigneeRef}
                options={assigneeOptions}
                disabled={disabled}
                ariaLabel={t("tasks.assignee")}
                valueLabel={assigneeName ?? t("tasks.unassigned")}
                unassignedLabel={t("tasks.unassigned")}
                searchPlaceholder={t("tasks.assignee_search_placeholder")}
                noResultsLabel={t("tasks.assignee_no_results")}
                triggerClassName="min-h-11 w-full justify-start gap-1.5 rounded-lg border border-border/80 bg-background px-2.5 text-caption font-medium text-foreground"
                onChange={(next) =>
                  onUpdate({
                    assigneeId: next?.id,
                  })
                }
              >
                {assigneeOption ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Avatar aria-hidden className="size-4 shrink-0">
                      {assigneeOption.avatarUrl ? (
                        <AvatarImage src={assigneeOption.avatarUrl} alt="" />
                      ) : null}
                      <AvatarFallback className="text-micro">
                        {assigneeOption.name.trim().slice(0, 1).toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{assigneeOption.name}</span>
                  </span>
                ) : (
                  <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                    <UserRound className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{t("tasks.unassigned")}</span>
                  </span>
                )}
              </AssigneePicker>
              <BasisLine basis={draft.assigneeBasis} />
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-caption text-muted-foreground">{t("tasks.priority")}</span>
              <PriorityPicker
                value={draft.priority}
                disabled={disabled}
                ariaLabel={t("tasks.priority")}
                appearance="pill"
                triggerClassName="min-h-11 w-full max-w-none justify-start rounded-lg bg-background px-2.5"
                onChange={(priority: TaskPriority) => onUpdate({ priority })}
              />
              <BasisLine basis={draft.priorityBasis} />
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-caption text-muted-foreground">{t("tasks.create.start_date")}</span>
              <DateField
                value={draft.startDate ?? ""}
                disabled={disabled}
                modal={false}
                ariaLabel={t("tasks.create.start_date")}
                placeholder={t("tasks.create.start_date")}
                formatOptions={{ day: "numeric", month: "short" }}
                triggerRender={<PillButton className="min-h-11 w-full max-w-none justify-start rounded-lg bg-background px-2.5" />}
                icon={<CalendarClock className="size-3.5 shrink-0" aria-hidden />}
                onChange={(next) => onUpdate({ startDate: next || undefined })}
              />
              <BasisLine basis={draft.startBasis} />
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-caption text-muted-foreground">{t("tasks.dueDate")}</span>
              <DateField
                value={draft.dueDate ?? ""}
                disabled={disabled}
                modal={false}
                ariaLabel={t("tasks.dueDate")}
                placeholder={t("tasks.dueDate")}
                formatOptions={{ day: "numeric", month: "short" }}
                triggerRender={<PillButton className="min-h-11 w-full max-w-none justify-start rounded-lg bg-background px-2.5" />}
                icon={<CalendarDays className="size-3.5 shrink-0" aria-hidden />}
                onChange={(next) => onUpdate({ dueDate: next || undefined })}
              />
              <BasisLine basis={draft.dueBasis} />
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-caption text-muted-foreground">{t("ai.proposal.field.labels")}</span>
              <LabelPicker
                labels={labels}
                selectedIds={selectedLabelIds}
                disabled={disabled}
                ariaLabel={t("ai.proposal.field.labels")}
                valueLabel={labelSummary || undefined}
                emptyLabel={t("tasks.table.labels_empty")}
                searchPlaceholder={t("tasks.create.label_search_placeholder")}
                noResultsLabel={t("tasks.create.options_no_results")}
                triggerClassName="min-h-11 w-full justify-start rounded-lg border border-border/80 bg-background px-2.5 text-caption font-medium text-foreground"
                onToggle={handleToggleLabel}
              >
                <Tags className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                {selectedLabels.length > 0 ? (
                  <span className="flex min-w-0 flex-wrap items-center gap-1 truncate">
                    {selectedLabels.map((lbl) => (
                      <span
                        key={lbl.id}
                        className={cn(
                          "inline-flex items-center rounded px-1.5 py-0.5 text-caption font-medium",
                          labelChipClass(lbl.color),
                        )}
                      >
                        {lbl.name}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="truncate text-muted-foreground">—</span>
                )}
              </LabelPicker>
              <BasisLine basis={draft.labelBasis} />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background">
            <button
              type="button"
              aria-expanded={descOpen}
              onClick={() => setDescOpen((prev) => !prev)}
              className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-caption text-foreground hover:bg-accent/40"
            >
              <span className="font-semibold">{t("drive.proposals.review.description_label")}</span>
              {descOpen ? (
                <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
            </button>
            {descOpen ? (
              <div className="flex flex-col gap-3 border-t border-border px-3.5 py-3 text-caption text-foreground">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`drive-proposal-goal-${draft.index}`}
                    className="font-semibold text-foreground"
                  >
                    {t("drive.proposals.review.description_goal_label")}
                  </label>
                  <Input
                    id={`drive-proposal-goal-${draft.index}`}
                    aria-label={t("drive.proposals.review.description_goal_aria", { index: itemNumber })}
                    value={draft.goal}
                    disabled={disabled}
                    onChange={(e) => onUpdate({ goal: e.target.value })}
                    className="min-h-11 text-caption"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`drive-proposal-checklist-${draft.index}`}
                    className="font-semibold text-foreground"
                  >
                    {t("drive.proposals.review.description_checklist_heading")}
                  </label>
                  <Textarea
                    id={`drive-proposal-checklist-${draft.index}`}
                    aria-label={t("drive.proposals.review.description_checklist_aria", { index: itemNumber })}
                    rows={Math.max(2, draft.checklist.length)}
                    value={draft.checklist.join("\n")}
                    disabled={disabled}
                    onChange={(e) => handleChecklistTextChange(e.target.value)}
                    className="min-h-16 text-caption"
                  />
                </div>

                <div
                  data-testid={`drive-proposal-excerpt-${draft.index}`}
                  className="flex flex-wrap items-center gap-1 text-caption text-muted-foreground"
                >
                  <span>{sourceLineText}</span>
                  {fileHref ? (
                    <AppLink
                      href={fileHref}
                      className="font-medium text-primary underline underline-offset-2 hover:opacity-80 pointer-coarse:min-h-11"
                    >
                      {fileName}
                    </AppLink>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {duplicate ? (
            <div
              data-testid={`drive-proposal-duplicate-${draft.index}`}
              className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive-soft px-3.5 py-3 text-caption text-destructive-soft-foreground"
            >
              <div>
                <strong className="font-semibold">
                  {t("drive.proposals.review.duplicate_prefix")}
                </strong>{" "}
                {duplicateHref ? (
                  <AppLink
                    href={duplicateHref}
                    className="font-medium underline underline-offset-2 hover:opacity-80"
                  >
                    {t("drive.proposals.review.duplicate_item", {
                      identifier: duplicate.identifier,
                      title: duplicate.title,
                    })}
                  </AppLink>
                ) : (
                  <span className="font-medium">
                    {t("drive.proposals.review.duplicate_item", {
                      identifier: duplicate.identifier,
                      title: duplicate.title,
                    })}
                  </span>
                )}{" "}
                {t("drive.proposals.review.duplicate_suffix")}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={draft.duplicateDecision === "skip" ? "destructive" : "outline"}
                  disabled={disabled}
                  className="min-h-11"
                  onClick={() => onDuplicateDecision("skip")}
                >
                  {t("drive.proposals.review.duplicate_skip")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={draft.duplicateDecision === "keep" ? "default" : "outline"}
                  disabled={disabled}
                  className="min-h-11"
                  onClick={() => onDuplicateDecision("keep")}
                >
                  {t("drive.proposals.review.duplicate_keep")}
                </Button>
                {draft.duplicateDecision === "keep" ? (
                  <span className="text-caption text-muted-foreground">
                    {t("drive.proposals.review.duplicate_kept")}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {needsDriveAccessNotice && assigneeName ? (
            <div
              data-testid={`drive-proposal-assignee-access-${draft.index}`}
              className="flex items-start gap-2 rounded-lg border border-warning-soft-foreground/20 bg-warning-soft px-3 py-2 text-caption text-warning-soft-foreground"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {t("drive.proposals.review.assignee_no_access", { name: assigneeName })}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
