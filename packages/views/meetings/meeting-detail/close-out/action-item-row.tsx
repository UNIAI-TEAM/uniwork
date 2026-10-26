"use client";
import { ArrowUpRight, CircleCheck, CircleDashed, EyeOff, Pencil, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MeetingActionItem } from "@uniwork/core/meetings/action-items";
import { actionItemTaskDefaults } from "@uniwork/core/meetings/summary-task-items";
import { paths } from "@uniwork/core/paths";
import type { TaskPriority } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../../../common/date-field";
import { useOptionalWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";
import { PriorityFlag as TaskPriorityFlag } from "../../../tasks/modes/status-pill";
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

/** A YYYY-MM-DD as the kit's "T3 27/10", read as a calendar day so no zone moves it; "" when it does not parse. */
export function dueWords(date: string | null | undefined, now: number, t: ReturnType<typeof useTranslation>["t"]): string {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? shortDay(`${date}T00:00:00Z`, now, t, "UTC") : "";
}

/** `dueWords` with the page's clock and language. */
export function useDueWords() {
  const { t } = useTranslation();
  const { now } = useDetail();
  return (date: string | null | undefined) => dueWords(date, now, t);
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

/** The task screen's priority chip, for a high or urgent priority only: the meta line stays quiet otherwise. */
export function PriorityFlag({ priority }: { priority: TaskPriority | undefined }) {
  if (priority !== "high" && priority !== "urgent") return null;
  return <TaskPriorityFlag priority={priority} withLabel />;
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
    <AppLink href={workspacePaths.task(task.id)} className={cn(cls, "relative z-1")} aria-label={label}>
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

/** The id of a row's title, which its actions name as what they act on. */
export const rowTitleId = (itemId: string) => `close-out-title-${itemId}`;

/** A row the whole of which opens something: its title stretches over it; the row's own controls sit above. */
const STRETCH = "after:absolute after:inset-0 after:rounded-md";
const ABOVE = "relative z-1";

const ROW = "-mx-2 grid min-h-13 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5";
const META = "col-span-2 col-start-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground";
const CHIP =
  "inline-flex h-5 items-center gap-1.5 rounded-sm pr-1.5 text-caption font-medium text-foreground hover:bg-background hover:shadow-[0_0_0_4px_var(--background)] aria-expanded:bg-background";

function TimeChip({ item }: { item: MeetingActionItem }) {
  const { meeting } = useDetail();
  if (item.evidence.length === 0) return <span />;
  // Kit `.item-time`: the chip hangs 6px into the gutter so its digits align with the column edge.
  return <span className={cn("-mr-1.5 inline-flex", ABOVE)}><EvidenceTimeChip meetingId={meeting.id} refs={item.evidence} /></span>;
}

/**
 * A pending item (brief §2 "Action item row"): checkbox, title, time chip;
 * then "Chờ giao", the owner and due chips (inline pickers for a clerk), the
 * priority flag and the row's actions. A member reads `waitFor` in place of
 * the chips. With `onOpen` the whole row opens the item. On a phone the title
 * wraps to two lines and the chips are plain text.
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
  /** The row opens the item (on a phone, outside select mode). */
  onOpen?: () => void;
  menu?: ReactNode;
}) {
  const { t } = useTranslation();
  const due = useDueWords();
  const titleId = rowTitleId(item.id);
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
  ) : onOpen ? (
    <button type="button" onClick={onOpen} className={cn("min-w-0 cursor-pointer truncate text-left text-body font-medium", STRETCH)}>
      <span id={titleId} title={item.title}>
        {item.title}
      </span>
    </button>
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
        "group/row relative hover:bg-surface-hover",
        phone && !selectable ? "-mx-2 flex flex-col gap-0.5 rounded-md px-2 py-1.5" : ROW,
        ticked && "bg-surface-selected hover:bg-surface-selected",
        !selectable && !phone && "grid-cols-[16px_minmax(0,1fr)_auto] items-start hover:bg-transparent",
      )}
    >
      {selectable ? (
        <Checkbox aria-labelledby={titleId} checked={ticked} onCheckedChange={(on) => onTick(on === true)} className={ABOVE} />
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
              <button type="button" title={dueTitle} className={cn(CHIP, ABOVE, "pr-0 tabular-nums", values.guessed && "text-warning")} />
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
      triggerClassName={cn(CHIP, ABOVE, "h-5 border-0 pr-1.5 pl-0 font-medium [&>svg:last-child]:hidden")}
    >
      {name ? <PersonTag userId={value} short bare /> : t("meetings.detail.closeOut.ownerNone")}
    </SearchableOptionPicker>
  );
}

/**
 * The row's two actions as icon buttons: Sửa opens the item (as the row does),
 * Bỏ qua sets it aside. They show while the row is hovered or holds focus, and
 * always on a touch screen, which has no hover.
 */
export function RowActions({ itemId, onEdit, onDismiss }: { itemId: string; onEdit: () => void; onDismiss: () => void }) {
  const { t } = useTranslation();
  // The page's hover hints are the native title (as the time and due chips), not a tooltip layer.
  const action = (label: string, Icon: LucideIcon, onClick: () => void) => (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="text-muted-foreground hover:text-foreground"
      title={label}
      aria-label={label}
      aria-describedby={rowTitleId(itemId)}
      onClick={onClick}
    >
      <Icon aria-hidden className="size-3.5" />
    </Button>
  );
  return (
    <span
      className={cn(
        ABOVE,
        "-my-0.5 -mr-1.5 ml-auto inline-flex gap-0.5 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100",
      )}
    >
      {action(t("meetings.detail.closeOut.edit"), Pencil, onEdit)}
      {action(t("meetings.detail.closeOut.dismiss"), EyeOff, onDismiss)}
    </span>
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
  const { workspacePaths } = useDetailPaths();
  const glyph = <CircleCheck aria-hidden className="mt-0.5 size-4 text-success" />;
  const text = item.task?.title || item.title;
  // The row opens its task, where it is edited.
  const title =
    item.task && workspacePaths ? (
      <AppLink href={workspacePaths.task(item.task.id)} className={cn("min-w-0 text-body text-pretty", STRETCH)}>
        {text}
      </AppLink>
    ) : (
      <span className="min-w-0 text-body text-pretty">{text}</span>
    );
  if (oneLine) {
    return (
      <li className="relative -mx-2 grid min-h-11 grid-cols-[16px_minmax(0,1fr)_20px_auto] items-center rounded-md hover:bg-surface-hover gap-x-3 px-2 py-1 @max-[37.5rem]/meeting:grid-cols-[16px_minmax(0,1fr)] @max-[37.5rem]/meeting:items-start">
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
    <li className={cn(ROW, "relative items-start hover:bg-surface-hover")}>
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
