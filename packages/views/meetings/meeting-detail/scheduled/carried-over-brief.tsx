"use client";
import { ArrowUpRight, ChevronRight, CircleAlert } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMeetingCarriedOverItems, type MeetingCarriedOverItem } from "@uniwork/core/meetings/action-items";
import { paths } from "@uniwork/core/paths";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";
import { MeetingPersonAvatar } from "../../meeting-person";
import { meetingAvatarTint } from "../avatar-tint";
import { dueWords } from "../close-out/action-item-row";
import { useDetail } from "../detail-context";
import { NoticeLine } from "../ui/notice-line";
import { Section } from "../ui/section";
import { Segmented } from "../ui/segmented";
import { TextButton } from "../ui/text-button";

type Task = MeetingCarriedOverItem["task"];

/** "Giao ban tuần 43 — Ra mắt SaoMai POS 3.0" → "Giao ban tuần 43": a series title's own part, before its dash. */
export function shortMeetingTitle(title: string | null | undefined): string {
  const full = (title ?? "").trim();
  return full.split(/\s+[—–]\s+/)[0] || full;
}

/** "Cần làm · T2 26/10 ↗" (kit `.task-chip`); a plain caption on a phone unless `pill` (the series brief keeps it). */
export function TaskChip({ task, pill = false, className }: { task: Task; pill?: boolean; className?: string }) {
  const { t } = useTranslation();
  const { now } = useDetail();
  const status = t(`tasks.status_${task.status ?? ""}`, { defaultValue: t("tasks.status_todo") });
  const day = dueWords(task.due_date, now, t);
  return (
    <span
      className={cn(
        "inline-flex h-5.5 flex-none items-center gap-1.5 rounded-sm bg-muted px-2 text-caption font-medium whitespace-nowrap tabular-nums group-hover:bg-border [&_svg]:size-3",
        !pill &&
          "@max-[37.5rem]/meeting:h-auto @max-[37.5rem]/meeting:gap-1 @max-[37.5rem]/meeting:bg-transparent @max-[37.5rem]/meeting:px-0 @max-[37.5rem]/meeting:font-normal @max-[37.5rem]/meeting:text-muted-foreground @max-[37.5rem]/meeting:group-hover:bg-transparent",
        task.overdue && "text-destructive",
        className,
      )}
    >
      {day ? `${status} · ${day}` : status}
      <ArrowUpRight aria-hidden />
    </span>
  );
}

/** One open task, the whole row a link to it (kit `.task`): owner, title, state and due. */
function TaskRow({ task, href }: { task: Task; href: string }) {
  const { t } = useTranslation();
  const { memberIndex } = useDetail();
  const owner = memberIndex.memberOf(task.assignee_id)?.display_name ?? t("meetings.detail.carriedOver.unassigned");
  return (
    <li>
      <AppLink
        href={href}
        className="group -mx-2 grid min-h-11 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 text-foreground hover:bg-surface-hover @max-[37.5rem]/meeting:grid-cols-[24px_minmax(0,1fr)] @max-[37.5rem]/meeting:gap-y-1 @max-[37.5rem]/meeting:py-2"
      >
        <MeetingPersonAvatar
          name={task.assignee_id ? owner : "?"}
          size={24}
          tint={meetingAvatarTint(task.assignee_id, memberIndex.members)}
          className="@max-[37.5rem]/meeting:row-span-2"
        />
        <span className="min-w-0 truncate text-body font-medium @max-[37.5rem]/meeting:whitespace-normal">{task.title}</span>
        <TaskChip task={task} className="@max-[37.5rem]/meeting:col-start-2" />
        <span className="sr-only">, {owner}</span>
      </AppLink>
    </li>
  );
}

/**
 * PhoneScheduled's sections: 24 apart, the heading row 28 tall with its count and
 * control centred (kit `.phone .section`, `.phone .sh`).
 */
export const PHONE_SECTION =
  "@max-[37.5rem]/meeting:mt-6 @max-[37.5rem]/meeting:[&>div:first-child]:min-h-7 @max-[37.5rem]/meeting:[&>div:first-child]:items-center";

/** "Minh Trần 2 · Hà Vũ 2 · hạn sớm nhất T2 26/10": who holds the work and the first due day. */
function lineSummary(items: readonly MeetingCarriedOverItem[], ownerName: (id?: string | null) => string, earliest: string, t: ReturnType<typeof useTranslation>["t"]): string {
  const counts = new Map<string, number>();
  for (const { task } of items) counts.set(ownerName(task.assignee_id), (counts.get(ownerName(task.assignee_id)) ?? 0) + 1);
  const owners = [...counts].sort((a, b) => b[1] - a[1]).map(([name, count]) => t("meetings.detail.carriedOver.ownerCount", { name, count }));
  return [...owners, earliest ? t("meetings.detail.carriedOver.earliest", { day: earliest }) : null].filter(Boolean).join(" · ");
}

/**
 * "Việc còn tồn n" (ScheduledMember, PhoneScheduled): the open tasks the
 * earlier meetings of the project or series handed out, "Của bạn | Tất cả",
 * and where they came from. `line` folds it to one heading row that opens in
 * place (ScheduledHost, Missed). `excludeMeetingId` leaves out the previous
 * meeting of a series, whose work the series brief already lists.
 */
export function CarriedOverBrief({
  variant = "full",
  excludeMeetingId,
  lineSummary: withSummary = true,
}: {
  variant?: "full" | "line";
  excludeMeetingId?: string;
  /** The line's caption ("Minh Trần 2 · … · hạn sớm nhất …"); Missed draws the heading and count alone. */
  lineSummary?: boolean;
}) {
  const { t } = useTranslation();
  const { user, workspace } = useWorkspace();
  const { meeting, memberIndex, now, isPhone } = useDetail();
  const query = useMeetingCarriedOverItems(meeting.id);
  const [scope, setScope] = useState<"mine" | "all" | null>(null);
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);

  if (query.isError && !query.data) {
    return (
      <Section id="viec-con-ton" title={t("meetings.detail.carriedOver.title")}>
        <NoticeLine tone="destructive" icon={CircleAlert} role="alert">
          {t("meetings.carriedOver.loadFailed")}{" "}
          <TextButton onClick={() => void query.refetch()}>{t("common.retry")}</TextButton>
        </NoticeLine>
      </Section>
    );
  }
  const items = (query.data?.items ?? []).filter((item) => item.meeting.id !== excludeMeetingId);
  if (items.length === 0) return null;
  const total = excludeMeetingId ? items.length : Math.max(query.data?.total ?? 0, items.length);
  const more = total - items.length;
  const mine = items.filter((item) => item.task.assignee_id === user.id);
  const canScope = mine.length > 0 && mine.length < items.length;
  const current = canScope ? (scope ?? "mine") : "all";
  const shown = current === "mine" ? mine : items;
  const sources = [...new Map(items.map((item) => [item.meeting.id, item.meeting])).values()];

  const list: ReactNode = (
    <>
      <ul aria-label={t("meetings.detail.carriedOver.title")} className="flex flex-col">
        {shown.map((item) => (
          <TaskRow key={item.action_item_id} task={item.task} href={ws.task(item.task.id)} />
        ))}
      </ul>
      {more > 0 ? <p className="mt-2 text-caption text-muted-foreground">{t("meetings.carriedOver.more", { count: more })}</p> : null}
      <p className="mt-2 pl-9 @max-[37.5rem]/meeting:mt-0 [&>a]:mr-3">
        {sources.map((source) => (
          <AppLink
            key={source.id}
            href={ws.meeting(source.id)}
            className="inline-flex items-center gap-0.5 rounded-xs text-caption text-primary underline-offset-2 hover:underline pointer-coarse:min-h-11 [&_svg]:size-3"
          >
            {t("meetings.detail.carriedOver.from", { title: shortMeetingTitle(source.title) })}
            <ChevronRight aria-hidden />
          </AppLink>
        ))}
      </p>
    </>
  );

  if (variant === "line") {
    const earliest = items.map((i) => i.task.due_date ?? "").filter(Boolean).sort()[0];
    const owner = (id?: string | null) => memberIndex.memberOf(id)?.display_name ?? t("meetings.detail.carriedOver.unassigned");
    return (
      <section id="viec-con-ton" aria-labelledby={headingId} className="mt-10 scroll-mt-6 first:mt-8 @max-[37.5rem]/meeting:mt-8">
        <h2 id={headingId}>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="group/line flex items-baseline gap-2 rounded-sm text-left"
          >
            <span className="text-title-sm font-semibold whitespace-nowrap decoration-border underline-offset-3 group-hover/line:underline">
              {t("meetings.detail.carriedOver.title")}
            </span>
            <span className="text-caption text-muted-foreground">{total}</span>
            {withSummary ? (
              <span className="text-caption text-muted-foreground @max-[37.5rem]/meeting:hidden">
                {lineSummary(items, owner, dueWords(earliest, now, t), t)}
              </span>
            ) : null}
            <ChevronRight
              aria-hidden
              className={cn("size-3.5 self-center text-muted-foreground transition-transform", open && "rotate-90")}
            />
          </button>
        </h2>
        {open ? <div className="mt-3">{list}</div> : null}
      </section>
    );
  }

  return (
    <Section
      id="viec-con-ton"
      title={t("meetings.detail.carriedOver.title")}
      count={total}
      // Phone: the task list sits 8 under the heading row (kit `.tasks`).
      className={cn(PHONE_SECTION, "@max-[37.5rem]/meeting:[&>div:last-child]:mt-2")}
      end={
        canScope ? (
          // Phone: the full-size control, 14px labels at 44 (PhoneScheduled); desktop the 32px scope switch.
          <Segmented
            size={isPhone ? undefined : "sm"}
            legend={t("meetings.detail.carriedOver.scopeLegend")}
            options={[
              { value: "mine", label: t("meetings.detail.carriedOver.mine"), count: mine.length },
              { value: "all", label: t("meetings.detail.carriedOver.all"), count: items.length },
            ]}
            value={current}
            onChange={setScope}
          />
        ) : undefined
      }
    >
      {list}
    </Section>
  );
}
