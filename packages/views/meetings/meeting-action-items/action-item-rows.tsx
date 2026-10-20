"use client";
import { useId, useState, type ReactNode } from "react";
import { CircleCheck, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingActionItem } from "@uniwork/core/meetings/action-items";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Label } from "@uniwork/ui/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../../navigation";
import { meetingLocale } from "../meeting-datetime";

export type ActionItemsVariant = "panel" | "compact";

export const LIST_CLASS: Record<ActionItemsVariant, string> = {
  panel: "divide-y divide-border overflow-hidden rounded-lg border border-border",
  compact: "space-y-2",
};

const ROW_CLASS: Record<ActionItemsVariant, string> = {
  panel: "px-3 py-2.5",
  compact: "rounded-xl border border-border bg-surface px-3 py-2.5",
};

/** A YYYY-MM-DD date as the reader writes dates; the raw string when it does not parse. */
export function formatDueDate(date: string, locale: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return date;
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(
    ms,
  );
}

/** Where a typed or live item came from; AI items need no badge, the section says so. */
function SourceBadge({ source }: { source?: string | null }) {
  const { t } = useTranslation();
  if (source !== "MANUAL" && source !== "LIVE") return null;
  return (
    <Badge variant="outline" className="ml-1.5 align-middle">
      {t(source === "MANUAL" ? "meetings.actionItemsSection.sourceManual" : "meetings.actionItemsSection.sourceLive")}
    </Badge>
  );
}

function RowShell({ variant, highlight, children }: { variant: ActionItemsVariant; highlight?: boolean; children: ReactNode }) {
  return (
    <li className={cn("space-y-1 text-body text-foreground transition-colors", ROW_CLASS[variant], highlight && "bg-surface-selected")}>
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
  const { t, i18n } = useTranslation();
  const said = [item.owner_text, item.due_text].filter((v): v is string => Boolean(v?.trim())).join(" · ");
  const dueLabel = item.suggested_due_date ? formatDueDate(item.suggested_due_date, meetingLocale(i18n.language)) : null;
  const selectable = onCheckedChange !== undefined;
  return (
    <RowShell variant={variant} highlight={checked}>
      <div className="flex items-start gap-3">
        {selectable ? (
          <Checkbox
            aria-label={item.title}
            className="mt-0.5"
            checked={checked}
            onCheckedChange={(v) => onCheckedChange(v === true)}
          />
        ) : null}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-pretty">
            {item.title}
            <SourceBadge source={item.source} />
          </p>
          {said ? <p className="text-caption text-muted-foreground">{said}</p> : null}
          {selectable && (suggestedName || dueLabel) ? (
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
          {evidence}
        </div>
        {action}
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
  /** Only the title and the task are read, so a carried-over task fits too. */
  item: Pick<MeetingActionItem, "title" | "task">;
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
  const state = task?.done ? "taskDone" : task?.overdue ? "taskOverdue" : "taskOpen";
  return (
    <RowShell variant={variant}>
      <p className="flex items-start gap-1.5">
        <CircleCheck aria-hidden className={cn("mt-0.5 size-4 shrink-0", task?.done ? "text-success" : "text-faint-foreground")} />
        {taskHref ? (
          <AppLink
            href={taskHref}
            className="min-w-0 text-pretty underline-offset-2 hover:underline"
            aria-label={t("meetings.actionItemsSection.openTask", { title })}
          >
            {title}
          </AppLink>
        ) : (
          <span className="min-w-0 text-pretty">{title}</span>
        )}
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5 pl-5.5 text-caption text-muted-foreground">
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
      {evidence ? <div className="pl-5.5">{evidence}</div> : null}
    </RowShell>
  );
}

/** A dismissed item, with its reason and, for a clerk, a way back. */
export function DismissedRow({
  item,
  variant,
  onRestore,
  restoring,
}: {
  item: MeetingActionItem;
  variant: ActionItemsVariant;
  onRestore?: () => void;
  restoring?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <RowShell variant={variant}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-pretty text-muted-foreground line-through">{item.title}</p>
          {item.dismiss_reason ? (
            <p className="text-caption text-muted-foreground">
              {t("meetings.actionItemsSection.reason", { reason: item.dismiss_reason })}
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
  onDismiss,
}: {
  title: string;
  pending: boolean;
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
        <Label htmlFor={reasonId} className="text-caption">
          {t("meetings.actionItemsSection.dismissReason")}
        </Label>
        <Textarea id={reasonId} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
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
