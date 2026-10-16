"use client";
import { useId, useMemo } from "react";
import { CircleCheck, ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isConvertedItem, summaryItemDraft } from "@uniwork/core/meetings/summary-task-items";
import type { MeetingSummary, MeetingSummaryActionItem } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { paths } from "@uniwork/core/paths";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { AppLink } from "../../navigation";
import { AiSummaryTasksDialog, type AiSummaryTaskSeed } from "../../tasks/ai-summary-tasks-dialog";
import { meetingLocale } from "../meeting-datetime";
import { useMemberIndex } from "../use-member-index";
import { useSummaryTaskCreation } from "./use-summary-task-creation";

type Variant = "panel" | "copilot";

const LIST_CLASS: Record<Variant, string> = {
  panel: "divide-y divide-border overflow-hidden rounded-lg border border-border",
  copilot: "space-y-2",
};

const ROW_CLASS: Record<Variant, string> = {
  panel: "px-3 py-2.5",
  copilot: "rounded-xl border border-border bg-surface px-3 py-2.5",
};

/** A YYYY-MM-DD date as the reader writes dates; the raw string when it does not parse. */
function formatDueDate(date: string, locale: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return date;
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(
    ms,
  );
}

function ActionItemRow({
  item,
  variant,
  selectable,
  checked,
  onCheckedChange,
  suggestedName,
  taskHref,
}: {
  item: MeetingSummaryActionItem;
  variant: Variant;
  selectable: boolean;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  suggestedName?: string;
  taskHref: string | null;
}) {
  const { t, i18n } = useTranslation();
  const converted = isConvertedItem(item);
  const aiWords = [item.owner, item.due].filter((v): v is string => Boolean(v?.trim())).join(" · ");
  const dueLabel = item.due_date ? formatDueDate(item.due_date, meetingLocale(i18n.language)) : null;
  const showSuggestion = selectable && !converted && (suggestedName || dueLabel);

  return (
    <li
      className={cn(
        "space-y-1 text-body text-foreground transition-colors",
        ROW_CLASS[variant],
        checked && !converted && "bg-surface-selected",
      )}
    >
      <div className="flex items-start gap-3">
        {selectable ? (
          <Checkbox
            aria-label={item.title}
            className="mt-0.5"
            checked={checked || converted}
            disabled={converted}
            onCheckedChange={(v) => onCheckedChange?.(v === true)}
          />
        ) : null}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-pretty">{item.title}</p>
          {aiWords ? <p className="text-caption text-muted-foreground">{aiWords}</p> : null}
          {showSuggestion ? (
            <p className="text-caption text-brand">
              <span aria-hidden>→ </span>
              {suggestedName ? (
                <>
                  <span className="sr-only">{t("meetings.assignedTo")} </span>
                  {suggestedName}
                </>
              ) : null}
              {suggestedName && dueLabel ? <span aria-hidden> · </span> : null}
              {dueLabel ? t("meetings.summaryAi.dueOn", { date: dueLabel }) : null}
            </p>
          ) : null}
          {converted ? (
            <p className="flex items-center gap-1 text-caption text-success">
              <CircleCheck aria-hidden className="size-3.5 shrink-0" />
              {item.task_id && taskHref ? (
                <AppLink
                  href={taskHref}
                  className="underline-offset-2 hover:underline"
                  aria-label={t("meetings.summaryAi.openTask", { title: item.title })}
                >
                  {t("meetings.summaryAi.created")}
                </AppLink>
              ) : (
                <span>{t("meetings.summaryAi.created")}</span>
              )}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * The host's side: tick the open items, review them in the shared dialog
 * (assignee, due date, priority, project; the server's suggestions are the
 * starting point and the host's choices are final), create. The call to
 * action stays rendered (aria-disabled with a reason when nothing is picked),
 * so the focus the dialog hands back on close has somewhere to land.
 */
function SelectableActionItems({
  summary,
  workspaceId,
  meetingId,
  projectId,
  variant,
  announce,
}: {
  summary: MeetingSummary;
  workspaceId: string;
  meetingId: string;
  projectId?: string;
  variant: Variant;
  announce: (message: string) => void;
}) {
  const { t } = useTranslation();
  const reasonId = useId();
  const flow = useSummaryTaskCreation({ workspaceId, meetingId, summary, announce });
  const { memberOf } = useMemberIndex(workspaceId);
  const count = flow.pickedOpen.length;
  const seeds = useMemo<AiSummaryTaskSeed[]>(
    () =>
      flow.pickedOpen.map((item) => ({
        index: item.index,
        title: item.title,
        owner: item.owner,
        due: item.due,
        draft: summaryItemDraft(item),
      })),
    [flow.pickedOpen],
  );
  const duplicateNote = t("meetings.summaryErrors.duplicateItemNote");
  const itemNotes = useMemo<Record<number, string> | undefined>(
    () =>
      flow.duplicateIndexes.size > 0
        ? Object.fromEntries([...flow.duplicateIndexes].map((index) => [index, duplicateNote]))
        : undefined,
    [flow.duplicateIndexes, duplicateNote],
  );
  const blocked = count === 0 || flow.pending;

  return (
    <>
      <ul className={LIST_CLASS[variant]}>
        {flow.items.map((item) => (
          <ActionItemRow
            key={item.index}
            item={item}
            variant={variant}
            selectable
            checked={flow.picked.has(item.index)}
            onCheckedChange={(on) => flow.toggle(item.index, on)}
            suggestedName={memberOf(item.suggested_assignee_id)?.display_name}
            taskHref={item.task_id ? flow.taskHref(item.task_id) : null}
          />
        ))}
      </ul>
      <Button
        type="button"
        size={variant === "panel" ? "sm" : "default"}
        variant={variant === "panel" ? "outline" : "brand"}
        className={variant === "panel" ? "mt-2.5" : "mt-3 w-full"}
        aria-disabled={blocked || undefined}
        aria-busy={flow.pending || undefined}
        aria-describedby={count === 0 ? reasonId : undefined}
        onClick={flow.openReview}
      >
        {flow.pending ? <Spinner data-icon="inline-start" /> : <ListChecks aria-hidden />}
        {variant === "panel" ? t("meetings.createTasks", { count }) : t("meetings.createTasksInUniwork", { count })}
      </Button>
      {count === 0 ? (
        <p id={reasonId} className="sr-only">
          {t("meetings.summaryAi.pickReason")}
        </p>
      ) : null}
      <AiSummaryTasksDialog
        open={flow.dialogOpen}
        onOpenChange={flow.setDialogOpen}
        wsId={workspaceId}
        idPrefix={`meeting-task-${summary.id}`}
        seeds={seeds}
        itemNotes={itemNotes}
        initialProjectId={projectId}
        pending={flow.pending}
        copy={{
          title: t("meetings.summaryAi.dialogTitle"),
          description: t("meetings.summaryAi.dialogDescription", { count }),
          projectLabel: t("meetings.summaryAi.projectLabel"),
          projectNone: t("meetings.summaryAi.projectNone"),
          unassignedLabel: t("meetings.summaryAi.unassigned"),
          suggestedOwner: (name) => t("meetings.summaryAi.suggestedOwner", { name }),
          spokenDue: (due) => t("meetings.summaryAi.spokenDue", { due }),
          submit: t("meetings.summaryAi.submit", { count }),
          submitting: t("meetings.summaryAi.submitting"),
        }}
        onConfirm={flow.submit}
      />
    </>
  );
}

/**
 * A summary's action items, shared by the meeting detail panel and the
 * in-room Copilot. Mount it under `key={summary.id}`: the selection belongs
 * to one summary. Without a workspace (a guest) or host rights it is a
 * read-only list, and the create mutation is never mounted.
 */
export function SummaryActionItems({
  summary,
  workspaceId,
  meetingId,
  canHost,
  projectId,
  variant,
  announce,
}: {
  summary: MeetingSummary;
  workspaceId?: string;
  meetingId: string;
  canHost: boolean;
  /** The project new tasks start in (the meeting's, when it still exists). */
  projectId?: string;
  variant: Variant;
  announce: (message: string) => void;
}) {
  const workspace = useOptionalWorkspace()?.workspace;
  const items = summary.action_items ?? [];
  if (canHost && workspaceId) {
    return (
      <SelectableActionItems
        summary={summary}
        workspaceId={workspaceId}
        meetingId={meetingId}
        projectId={projectId}
        variant={variant}
        announce={announce}
      />
    );
  }
  return (
    <ul className={LIST_CLASS[variant]}>
      {items.map((item) => (
        <ActionItemRow
          key={item.index}
          item={item}
          variant={variant}
          selectable={false}
          checked={false}
          taskHref={
            item.task_id && workspace && workspaceId
              ? paths.workspace(workspace.organization_slug, workspace.slug).task(item.task_id)
              : null
          }
        />
      ))}
    </ul>
  );
}
