"use client";
import { ArrowUpRight, CircleCheck, CircleDashed, Ellipsis, Flag, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MeetingActionItem } from "@uniwork/core/meetings/action-items";
import { actionItemTaskDefaults } from "@uniwork/core/meetings/summary-task-items";
import { paths } from "@uniwork/core/paths";
import type { TaskPriority } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../../../common/date-field";
import { useOptionalWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";
import { SearchableOptionPicker } from "../../../tasks/pickers/searchable-option-picker";
import { MeetingPersonAvatar } from "../../meeting-person";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";
import { shortDay } from "../format";
import { EvidenceTimeChip } from "../overview/evidence-chip";
import type { EffectiveValues } from "./use-close-out";

type Override = { assignee_id?: string | null; due_date?: string | null };

/** "Minh" of "Minh Trần": the kit's chips carry the first name. */
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** A YYYY-MM-DD as the kit's "T3 27/10"; "" when it does not parse. */
export function useDueWords() {
  const { t } = useTranslation();
  const { now } = useDetail();
  return (date: string | null | undefined) =>
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? shortDay(`${date}T00:00:00Z`, now, t, "UTC") : "";
}

/** Avatar 20 + a name, tinted by join order (PLAN D11). */
export function PersonTag({ userId, short, bare, className }: { userId: string | null | undefined; short?: boolean; bare?: boolean; className?: string }) {
  const { memberIndex } = useDetail();
  const name = memberIndex.memberOf(userId)?.display_name ?? "";
  if (!name) return null;
  // Bare: avatar and first name straight inside the caller's control (kit `.chip`, `.cell-ctl`); className goes to the avatar.
  if (bare) {
    return (
      <>
        <MeetingPersonAvatar name={name} size={20} tint={meetingAvatarTint(userId, memberIndex.members)} className={className} />
        {firstName(name)}
      </>
    );
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", short && "whitespace-nowrap", className)}>
      <MeetingPersonAvatar name={name} size={20} tint={meetingAvatarTint(userId, memberIndex.members)} />
      {/* The short name is the tag's own text (kit `.cell-ctl`: avatar, then the name), the long one truncates. */}
      {short ? firstName(name) : <span className="truncate">{name}</span>}
    </span>
  );
}

/** "⚑ Cao" in warning ink, for a high or urgent priority only. */
export function PriorityFlag({ priority }: { priority: TaskPriority | undefined }) {
  const { t } = useTranslation();
  if (priority !== "high" && priority !== "urgent") return null;
  return (
    <span className="inline-flex items-center gap-1 font-medium text-warning">
      <Flag aria-hidden className="size-3" />
      {t(`tasks.priority_${priority}`)}
    </span>
  );
}

/** The converted item's task: "Cần làm · T2 26/10 ↗", success once done. */
export function TaskChip({ task }: { task: NonNullable<MeetingActionItem["task"]> }) {
  const { t } = useTranslation();
  const due = useDueWords();
  const { workspacePaths } = useDetailPaths();
  const status = task.done ? t("meetings.detail.closeOut.taskDone") : t(`tasks.status_${task.status ?? "todo"}`, { defaultValue: t("tasks.status_todo") });
  const date = due(task.due_date);
  const text = date ? t("meetings.detail.closeOut.taskChip", { status, date }) : status;
  const cls = cn(
    "inline-flex h-5.5 items-center gap-1.5 rounded-sm bg-muted px-2 text-caption font-medium whitespace-nowrap text-foreground hover:bg-border",
    task.done && "bg-success-soft text-success hover:bg-success-soft",
    task.overdue && !task.done && "text-destructive",
  );
  const label = t("meetings.detail.closeOut.taskChipLabel", { text });
  const body = (
    <>
      {text}
      <ArrowUpRight aria-hidden className="size-3" />
    </>
  );
  return workspacePaths ? (
    <AppLink href={workspacePaths.task(task.id)} className={cls} aria-label={label}>
      {body}
    </AppLink>
  ) : (
    <span className={cls}>{body}</span>
  );
}

/** The workspace's paths for a task link, when the page has a workspace. */
function useDetailPaths() {
  const workspace = useOptionalWorkspace()?.workspace;
  return { workspacePaths: workspace ? paths.workspace(workspace.organization_slug, workspace.slug) : null };
}

const ROW = "-mx-2 grid min-h-13 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5";
const META = "col-span-2 col-start-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground";
const CHIP =
  "inline-flex h-5 items-center gap-1.5 rounded-sm pr-1.5 text-caption font-medium text-foreground hover:bg-background hover:shadow-[0_0_0_4px_var(--background)] aria-expanded:bg-background";

function TimeChip({ item }: { item: MeetingActionItem }) {
  const { meeting } = useDetail();
  if (item.evidence.length === 0) return <span />;
  // Kit `.item-time`: the chip hangs 6px into the gutter so its digits align with the column edge.
  return <span className="-mr-1.5 inline-flex"><EvidenceTimeChip meetingId={meeting.id} refs={item.evidence} /></span>;
}

/**
 * A pending item (brief §2 "Action item row"): checkbox, title, time chip;
 * then "Chờ giao", the owner and due chips (inline pickers for a clerk), the
 * priority flag and ⋯. A member reads `waitFor` in place of the chips. On a
 * phone the title wraps to two lines and the chips are plain text.
 */
export function PendingItemRow({
  item,
  values,
  ticked,
  onTick,
  onOverride,
  waitFor,
  phone,
  onOpen,
  menu,
}: {
  item: MeetingActionItem;
  values: EffectiveValues;
  /** Present when the row can be ticked. */
  ticked?: boolean;
  onTick?: (on: boolean) => void;
  /** Present for a clerk: the chips become pickers. */
  onOverride?: (patch: Override) => void;
  /** A member's line: "Chờ Lan Phạm hoặc Hà Vũ giao". */
  waitFor?: string;
  phone?: boolean;
  /** Phone, outside select mode: the title opens the item. */
  onOpen?: () => void;
  menu?: ReactNode;
}) {
  const { t } = useTranslation();
  const due = useDueWords();
  const titleId = `close-out-title-${item.id}`;
  const date = due(values.due_date);
  const said = item.due_text?.trim() ?? "";
  const selectable = onTick !== undefined;
  const title = phone ? (
    onOpen && !selectable ? (
      <button type="button" onClick={onOpen} className="text-left text-body font-medium text-pretty after:absolute after:inset-0 after:rounded-md">
        <span id={titleId} className="line-clamp-2">{item.title}</span>
      </button>
    ) : (
      <span id={titleId} className="line-clamp-2 text-body font-medium text-pretty">{item.title}</span>
    )
  ) : (
    <span id={titleId} title={item.title} className="min-w-0 truncate text-body font-medium">
      {item.title}
    </span>
  );
  const dueText = (
    <>
      {values.guessed ? <TriangleAlert aria-hidden className="size-3" /> : null}
      {values.guessed ? `~${date}` : date}
    </>
  );
  const dueLabel = values.guessed
    ? t("meetings.detail.closeOut.dueGuessedLabel", { said, date })
    : date
      ? t("meetings.detail.closeOut.dueLabel", { date })
      : t("meetings.detail.closeOut.dueNoneLabel");
  const dueTitle = values.guessed ? t("meetings.detail.closeOut.dueGuessedTitle", { said, date }) : undefined;
  return (
    <li
      data-close-out-row={item.id}
      className={cn(
        "relative hover:bg-surface-hover",
        phone && !selectable ? "-mx-2 flex flex-col gap-0.5 rounded-md px-2 py-1.5" : ROW,
        ticked && "bg-surface-selected hover:bg-surface-selected",
        !selectable && !phone && "grid-cols-[16px_minmax(0,1fr)_auto] items-start hover:bg-transparent",
      )}
    >
      {selectable ? (
        <Checkbox aria-labelledby={titleId} checked={ticked} onCheckedChange={(on) => onTick(on === true)} />
      ) : phone ? null : (
        <CircleDashed aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
      )}
      {title}
      {phone ? null : <TimeChip item={item} />}
      <div className={cn(META, phone && "col-span-1 font-medium text-foreground", phone && !selectable && "col-auto")}>
        {phone ? null : waitFor !== undefined ? (
          <span>{waitFor}</span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <CircleDashed aria-hidden className="size-3" />
            {t("meetings.detail.closeOut.statePending")}
          </span>
        )}
        {waitFor !== undefined ? null : onOverride && !phone ? (
          <OwnerChip value={values.assignee_id} onChange={(assignee_id) => onOverride({ assignee_id })} />
        ) : (
          <PersonTag userId={values.assignee_id} short />
        )}
        {onOverride && !phone ? (
          <DateField
            value={values.due_date ?? ""}
            onChange={(v) => onOverride({ due_date: v || null })}
            ariaLabel={dueLabel}
            triggerRender={
              <button type="button" title={dueTitle} className={cn(CHIP, "pr-0 tabular-nums", values.guessed && "text-warning")} />
            }
            renderTrigger={() => (date ? dueText : t("meetings.detail.closeOut.dueNone"))}
          />
        ) : date ? (
          <span title={dueTitle} className={cn("inline-flex items-center gap-1 font-medium text-foreground tabular-nums", values.guessed && "text-warning")}>
            <span className="sr-only">{t("meetings.detail.closeOut.dueSr")}</span>
            {dueText}
            {phone && values.guessed && said ? (
              <span className="ml-1.5 font-normal text-muted-foreground">{t("meetings.detail.closeOut.guessedFrom", { said })}</span>
            ) : null}
          </span>
        ) : null}
        <PriorityFlag priority={values.priority} />
        {phone ? <span className="relative z-1 ml-auto"><TimeChip item={item} /></span> : menu}
      </div>
    </li>
  );
}

/** The inline owner picker (kit `.chip`): avatar + first name, searchable when the team is large. */
function OwnerChip({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { t } = useTranslation();
  const { memberIndex } = useDetail();
  const name = memberIndex.memberOf(value)?.display_name;
  return (
    <SearchableOptionPicker
      value={value}
      onChange={onChange}
      options={memberIndex.members.map((m) => ({ value: m.user_id, label: m.display_name }))}
      emptyOption={{ value: "", label: t("meetings.detail.closeOut.ownerNone") }}
      ariaLabel={name ? t("meetings.detail.closeOut.ownerLabel", { name }) : t("meetings.detail.closeOut.ownerNoneLabel")}
      searchPlaceholder={t("meetings.detail.closeOut.ownerSearch")}
      noResultsLabel={t("meetings.detail.closeOut.ownerNoMatch")}
      triggerClassName={cn(CHIP, "h-5 border-0 pr-1.5 pl-0 font-medium [&>svg:last-child]:hidden")}
    >
      {name ? <PersonTag userId={value} short bare /> : t("meetings.detail.closeOut.ownerNone")}
    </SearchableOptionPicker>
  );
}

/** The row's ⋯: Bỏ qua… and Sửa… */
export function RowMenu({ onDismiss, onEdit }: { onDismiss: () => void; onEdit: () => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="-mr-1.75 ml-auto h-5 w-6 text-muted-foreground"
            aria-label={t("meetings.detail.closeOut.more")}
          />
        }
      >
        <Ellipsis aria-hidden className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-50">
        <DropdownMenuItem className="h-9 gap-2 px-2.5" onClick={onEdit}>
          {t("meetings.detail.closeOut.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem className="h-9 gap-2 px-2.5" onClick={onDismiss}>
          {t("meetings.detail.closeOut.dismiss")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A converted item: ✓, title (400), time chip, then its task chip and flag.
 * `oneLine` is the outsider's row: owner avatar and task chip in columns, no time chip.
 */
export function ConvertedItemRow({ item, oneLine }: { item: MeetingActionItem; oneLine?: boolean }) {
  const { t } = useTranslation();
  const { memberIndex } = useDetail();
  const owner = memberIndex.memberOf(item.task?.assignee_id)?.display_name;
  const priority = actionItemTaskDefaults(item, undefined).priority;
  const glyph = <CircleCheck aria-hidden className="mt-0.5 size-4 text-success" />;
  const title = <span className="min-w-0 text-body text-pretty">{item.task?.title || item.title}</span>;
  if (oneLine) {
    return (
      <li className="-mx-2 grid min-h-11 grid-cols-[16px_minmax(0,1fr)_20px_auto] items-center gap-x-3 px-2 py-1 @max-[37.5rem]/meeting:grid-cols-[16px_minmax(0,1fr)] @max-[37.5rem]/meeting:items-start">
        {glyph}
        {title}
        <span className="inline-flex @max-[37.5rem]/meeting:col-start-2" title={owner}>
          {item.task?.assignee_id ? (
            <MeetingPersonAvatar name={owner ?? ""} size={20} tint={meetingAvatarTint(item.task.assignee_id, memberIndex.members)} />
          ) : null}
          {owner ? <span className="sr-only">{t("meetings.detail.closeOut.ownerSr", { name: owner })}</span> : null}
        </span>
        <span className="justify-self-start @max-[37.5rem]/meeting:col-start-2">{item.task ? <TaskChip task={item.task} /> : null}</span>
      </li>
    );
  }
  return (
    <li className={cn(ROW, "items-start")}>
      {glyph}
      {title}
      <TimeChip item={item} />
      <div className={META}>
        {item.task ? <TaskChip task={item.task} /> : null}
        <PriorityFlag priority={priority} />
      </div>
    </li>
  );
}
