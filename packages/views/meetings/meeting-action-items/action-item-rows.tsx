"use client";
import { useId, useState, type ReactNode } from "react";
import { Circle, CircleCheck, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingActionItem } from "@uniwork/core/meetings/action-items";
import { actionItemTaskDefaults } from "@uniwork/core/meetings/summary-task-items";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Label } from "@uniwork/ui/components/ui/label";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../../navigation";
import { formatMeetingClock, formatMeetingDay, meetingLocale } from "../meeting-datetime";
import { ScribeSign } from "../scribe-sign";

export type ActionItemsVariant = "panel" | "compact";

export const LIST_CLASS: Record<ActionItemsVariant, string> = {
  panel: "divide-y divide-border overflow-hidden rounded-lg border border-border",
  compact: "space-y-2",
};

const ROW_CLASS: Record<ActionItemsVariant, string> = {
  panel: "px-3 py-2.5",
  compact: "rounded-xl border border-border bg-surface px-3 py-2.5",
};

/** A YYYY-MM-DD due date in the hero's date style ("Thứ Sáu, 25 tháng 9"); the raw string when it does not parse. */
export function formatDueDate(date: string, locale: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatMeetingDay(date, locale) : date;
}

/** "Minh" said of "Minh Lê": every word said is a word of the member's name. */
function saidOfMember(said: string, name: string): boolean {
  const words = (text: string) => text.normalize("NFC").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const named = new Set(words(name));
  const spoken = words(said);
  return spoken.length > 0 && spoken.every((word) => named.has(word));
}

/** What an open task's state reads as: not every unfinished task is being worked on. */
function openStateKey(status: string | null | undefined): string {
  switch (status) {
    case "todo":
    case "backlog":
      return "taskNotStarted";
    case "in_progress":
    case "in_review":
      return "taskOpen";
    default:
      return "taskNotDone";
  }
}

/**
 * Where an item came from: typed by a clerk, drawn from the AI summary, or
 * heard by Thư ký UNI during the meeting (with when). An unknown source
 * shows nothing rather than a guess.
 */
function SourceBadge({ source, createdAt }: { source?: string | null; createdAt?: string | null }) {
  const { t, i18n } = useTranslation();
  if (source !== "MANUAL" && source !== "LIVE" && source !== "AI") return null;
  const createdMs = createdAt ? Date.parse(createdAt) : NaN;
  const time = source === "LIVE" && Number.isFinite(createdMs) ? formatMeetingClock(createdMs, meetingLocale(i18n.language)) : null;
  return (
    <Badge variant="outline" className="ml-1.5 align-middle">
      {source === "MANUAL" ? null : <ScribeSign className="mr-0" />}
      {source === "MANUAL"
        ? t("meetings.actionItemsSection.sourceManual")
        : source === "AI"
          ? t("meetings.actionItemsSection.sourceAi")
          : time
            ? t("meetings.actionItemsSection.sourceLiveAt", { time })
            : t("meetings.actionItemsSection.sourceLive")}
    </Badge>
  );
}

function RowShell({
  variant,
  highlight,
  itemId,
  children,
}: {
  variant: ActionItemsVariant;
  highlight?: boolean;
  /** Lets the section find the row's checkbox to move focus to. */
  itemId?: string;
  children: ReactNode;
}) {
  return (
    <li
      data-action-item={itemId}
      className={cn(
        "space-y-1 text-body text-foreground transition-colors",
        ROW_CLASS[variant],
        highlight && "bg-surface-selected",
      )}
    >
      {children}
    </li>
  );
}

/**
 * A pending item: what was said about it (owner, due) and what the server
 * suggests. A clerk ticks it for the review and can dismiss it; everyone
 * else reads it.
 */
export function PendingRow({
  item,
  variant,
  suggestedName,
  checked,
  onCheckedChange,
  action,
  evidence,
}: {
  item: MeetingActionItem;
  variant: ActionItemsVariant;
  suggestedName?: string;
  /** Present for a clerk only. */
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  action?: ReactNode;
  /** The item's evidence chip (MeetingEvidenceChip). */
  evidence?: ReactNode;
}) {
  const checkboxId = useId();
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const selectable = onCheckedChange !== undefined;
  const dueLabel = item.suggested_due_date ? formatDueDate(item.suggested_due_date, locale) : null;
  // The priority "Assign" applies, so the clerk sees it before assigning without opening the item.
  const priority = actionItemTaskDefaults(item, undefined).priority;
  // What was said, less what the suggestion already names: one name and one due date, once.
  const sameOwner = Boolean(suggestedName) && saidOfMember(item.owner_text ?? "", suggestedName ?? "");
  const said = [sameOwner ? null : item.owner_text, selectable && dueLabel ? null : item.due_text]
    .filter((v): v is string => Boolean(v?.trim()))
    .join(" · ");
  const suggestion = [
    suggestedName,
    dueLabel ? t("meetings.summaryAi.dueOn", { date: dueLabel }) : null,
    priority
      ? t("meetings.actionItemsSection.priorityValue", { priority: t(`tasks.priority_${priority}`).toLocaleLowerCase(locale) })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <RowShell variant={variant} highlight={checked} itemId={item.id}>
      <div className="flex items-start gap-3">
        {selectable ? (
          <Checkbox
            id={checkboxId}
            // 16px box; the primitive grows its target to 44px on touch.
            className="mt-0.5"
            checked={checked}
            onCheckedChange={(v) => onCheckedChange(v === true)}
          />
        ) : null}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-pretty">
            {selectable ? (
              // The title ticks the box too, and names it (the badge stays out of the name).
              <label htmlFor={checkboxId} className="cursor-pointer">
                {item.title}
              </label>
            ) : (
              item.title
            )}
            <SourceBadge source={item.source} createdAt={item.created_at} />
          </p>
          {said ? <p className="text-caption text-muted-foreground">{said}</p> : null}
          {selectable && suggestion ? (
            <p className="text-caption text-muted-foreground">{t("meetings.actionItemsSection.suggestion", { value: suggestion })}</p>
          ) : null}
          {/* The commands sit under the title, so it keeps the full width in the room's narrow panel too. */}
          {evidence || action ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {evidence}
              {action ? <div className="ml-auto">{action}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </RowShell>
  );
}

/** A converted item: its task, who has it, when it is due, and whether it is done or late. */
export function ConvertedRow({
  item,
  variant,
  taskHref,
  assigneeName,
  evidence,
}: {
  /** Only the title, the task and the source are read, so a carried-over task fits too. */
  item: Pick<MeetingActionItem, "title" | "task"> & Partial<Pick<MeetingActionItem, "source" | "created_at">>;
  variant: ActionItemsVariant;
  taskHref: string | null;
  assigneeName?: string;
  /** The item's evidence chip (MeetingEvidenceChip). */
  evidence?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const task = item.task;
  const title = task?.title || item.title;
  const due = task?.due_date ? formatDueDate(task.due_date, meetingLocale(i18n.language)) : null;
  const state = task?.done ? "taskDone" : task?.overdue ? "taskOverdue" : openStateKey(task?.status);
  // Only a finished task wears the check; an open one is an empty circle.
  const Glyph = task?.done ? CircleCheck : Circle;
  return (
    <RowShell variant={variant}>
      <p className="flex items-start gap-3">
        <Glyph aria-hidden className={cn("mt-0.5 size-4 shrink-0", task?.done ? "text-success" : "text-faint-foreground")} />
        <span className="min-w-0 text-pretty">
          {taskHref ? (
            <AppLink
              href={taskHref}
              // 44px tall on touch through ::after; the 20px line alone is too small a tap.
              className="relative underline-offset-2 hover:underline pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-3"
              aria-label={t("meetings.actionItemsSection.openTask", { title })}
            >
              {title}
            </AppLink>
          ) : (
            title
          )}
          <SourceBadge source={item.source} createdAt={item.created_at} />
        </span>
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5 pl-7 text-caption text-muted-foreground">
        <span>{assigneeName ?? t("meetings.actionItemsSection.unassigned")}</span>
        {due ? (
          <>
            <span aria-hidden>·</span>
            <span className={cn(task?.overdue && "text-destructive")}>{t("meetings.summaryAi.dueOn", { date: due })}</span>
          </>
        ) : null}
        <span aria-hidden>·</span>
        <span className={cn(task?.overdue && "font-medium text-destructive", task?.done && "text-success")}>
          {t(`meetings.actionItemsSection.${state}`)}
        </span>
      </p>
      {evidence ? <div className="pl-7">{evidence}</div> : null}
    </RowShell>
  );
}

/** A dismissed item, with its reason and, for a clerk, a way back. */
export function DismissedRow({
  item,
  variant,
  onRestore,
  restoring,
  error,
}: {
  item: MeetingActionItem;
  variant: ActionItemsVariant;
  onRestore?: () => void;
  restoring?: boolean;
  /** Why the last restore failed, said beside the row. */
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <RowShell variant={variant}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-pretty text-muted-foreground">
            <span className="line-through">{item.title}</span>
            <SourceBadge source={item.source} createdAt={item.created_at} />
          </p>
          {item.dismiss_reason ? (
            <p className="text-caption text-muted-foreground">
              {t("meetings.actionItemsSection.reason", { reason: item.dismiss_reason })}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-caption text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        {onRestore ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t("meetings.actionItemsSection.restoreLabel", { title: item.title })}
            aria-disabled={restoring || undefined}
            onClick={() => {
              if (!restoring) onRestore();
            }}
          >
            {restoring ? <Spinner data-icon="inline-start" /> : <RotateCcw aria-hidden />}
            {t("meetings.actionItemsSection.restore")}
          </Button>
        ) : null}
      </div>
    </RowShell>
  );
}

/** Dismiss with an optional reason, asked in a small popover beside the item. */
export function DismissActionItemButton({
  title,
  pending,
  error,
  onDismiss,
}: {
  title: string;
  pending: boolean;
  /** Why the last dismiss failed, said in the popover. */
  error?: string;
  onDismiss: (reason: string, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type="button" size="sm" variant="ghost" aria-label={t("meetings.actionItemsSection.dismissLabel", { title })}>
            {t("meetings.actionItemsSection.dismiss")}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72 space-y-2">
        <PopoverTitle className="text-label">{t("meetings.actionItemsSection.dismissTitle")}</PopoverTitle>
        <Label htmlFor={reasonId} className="text-caption">
          {t("meetings.actionItemsSection.dismissReason")}
        </Label>
        <Textarea
          id={reasonId}
          rows={2}
          maxLength={500}
          className="resize-none"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            // Reversible (Restore brings it back): not the destructive red.
            variant="outline"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (pending) return;
              onDismiss(reason.trim(), () => {
                setOpen(false);
                setReason("");
              });
            }}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {t("meetings.actionItemsSection.dismissConfirm")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
