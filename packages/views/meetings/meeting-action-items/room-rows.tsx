"use client";
import { useId, type ReactNode } from "react";
import { Check, Clock, Maximize2, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingActionItem } from "@uniwork/core/meetings/action-items";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../../navigation";
import { formatMeetingClock, meetingLocale } from "../meeting-datetime";
import { MeetingPersonAvatar } from "../meeting-person";
import { ScribeSign } from "../scribe-sign";
import { formatDueDate } from "./action-item-rows";

/** A workspace member on a row: name and photo. */
interface RoomPerson {
  display_name: string;
  avatar_url?: unknown;
}

// A 44px-tall target on touch through ::after, whatever the control's own height.
const TOUCH =
  "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:top-1/2 pointer-coarse:after:h-11 pointer-coarse:after:-translate-y-1/2";
const CHIP = "inline-flex h-6 items-center rounded-full text-caption font-medium";
const SOLID_CHIP = `${CHIP} bg-surface text-foreground inset-ring inset-ring-border`;
const DASHED_CHIP = `${CHIP} ${TOUCH} gap-1 border border-dashed border-border px-2 text-muted-foreground hover:text-foreground`;

/** A group's heading in the room ("Chờ xử lý (3)"); the pending one carries the clerk's select-all box. */
export function RoomGroupHeading({
  children,
  pick,
}: {
  children: string;
  pick?: { picked: number; total: number; onPickAll: (on: boolean) => void };
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2.5 px-1 pt-1 pb-2">
      {pick ? (
        <Checkbox
          className="size-4.5"
          aria-label={t("meetings.panel.actions.selectAll")}
          checked={pick.total > 0 && pick.picked === pick.total}
          indeterminate={pick.picked > 0 && pick.picked < pick.total}
          onCheckedChange={(v) => pick.onPickAll(v === true)}
        />
      ) : null}
      <h3 className="text-caption font-semibold text-muted-foreground">{children}</h3>
    </div>
  );
}

/**
 * A pending item as the clerk works it in the room: tick, title, who and when
 * as chips (a clerk's empty one opens the composer to fill it in), the
 * scribe's mark and time on what it heard, and two icon commands. Everyone
 * else reads the same row without the box, the commands or the empty chips.
 */
export function RoomPendingRow({
  item,
  assignee,
  checked = false,
  onCheckedChange,
  onEdit,
  actions,
  evidence,
}: {
  item: MeetingActionItem;
  assignee?: RoomPerson;
  /** Present for a clerk only. */
  onCheckedChange?: (checked: boolean) => void;
  checked?: boolean;
  /** Opens the item's "Edit & assign" composer; present for a clerk only. */
  onEdit?: () => void;
  actions?: ReactNode;
  evidence?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const checkboxId = useId();
  const locale = meetingLocale(i18n.language);
  const due = item.suggested_due_date ? formatDueDate(item.suggested_due_date, locale) : null;
  const createdMs = item.source === "LIVE" && item.created_at ? Date.parse(item.created_at) : NaN;
  const heardAt = Number.isFinite(createdMs) ? formatMeetingClock(createdMs, locale) : null;
  const Chip = onEdit ? "button" : "span";
  const chipProps = onEdit ? { type: "button" as const, onClick: onEdit } : {};
  return (
    <li
      data-action-item={item.id}
      className={cn(
        "flex gap-2.5 rounded-xl p-2.5 inset-ring transition-colors",
        checked ? "bg-brand-subtle/50 inset-ring-brand/20" : "inset-ring-border",
      )}
    >
      {onCheckedChange ? (
        <Checkbox id={checkboxId} className="mt-px size-4.5" checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-pretty text-foreground">
          {onCheckedChange ? (
            <label htmlFor={checkboxId} className="cursor-pointer">
              {item.title}
            </label>
          ) : (
            item.title
          )}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {assignee ? (
            <Chip {...chipProps} className={cn(SOLID_CHIP, onEdit && TOUCH, "gap-1.25 pr-2 pl-0.75")}>
              <MeetingPersonAvatar name={assignee.display_name} avatarUrl={assignee.avatar_url} size={18} />
              {assignee.display_name}
            </Chip>
          ) : onEdit ? (
            <button type="button" className={DASHED_CHIP} onClick={onEdit}>
              <UserPlus aria-hidden className="size-3" />
              {t("meetings.assignTaskTo")}
            </button>
          ) : null}
          {due ? (
            <Chip {...chipProps} className={cn(SOLID_CHIP, onEdit && TOUCH, "gap-1 px-2")}>
              <Clock aria-hidden className="size-3 text-muted-foreground" />
              {due}
            </Chip>
          ) : onEdit ? (
            <button type="button" className={DASHED_CHIP} onClick={onEdit}>
              {t("meetings.panel.feed.addDue")}
            </button>
          ) : null}
          {heardAt ? (
            <span className="inline-flex items-center text-caption text-faint-foreground tabular-nums">
              <ScribeSign className="mr-1 [&_svg]:size-3" />
              {heardAt}
            </span>
          ) : null}
          {evidence}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 gap-0.5 self-start">{actions}</div> : null}
    </li>
  );
}

/** An assigned item: the done tick, the task's title, who has it and a way to open it. */
export function RoomConvertedRow({
  item,
  taskHref,
  assignee,
}: {
  item: MeetingActionItem;
  taskHref: string | null;
  assignee?: RoomPerson;
}) {
  const { t } = useTranslation();
  const title = item.task?.title || item.title;
  return (
    <li className="flex items-center gap-2.5 rounded-xl p-2.5 inset-ring inset-ring-border">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success-solid text-on-solid">
        <Check aria-hidden className="size-3" />
      </span>
      <span className="min-w-0 flex-1 text-body text-pretty text-foreground">{title}</span>
      {assignee ? <MeetingPersonAvatar name={assignee.display_name} avatarUrl={assignee.avatar_url} size={20} /> : null}
      {taskHref ? (
        <AppLink
          href={taskHref}
          aria-label={t("meetings.actionItemsSection.openTask", { title })}
          className={cn(TOUCH, "grid size-7 shrink-0 place-items-center rounded-md text-faint-foreground hover:bg-surface-hover hover:text-foreground")}
        >
          <Maximize2 aria-hidden className="size-3.5" />
        </AppLink>
      ) : null}
    </li>
  );
}
