"use client";
import { useState } from "react";
import { ChevronDown, RotateCcwClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingCarriedOverItems, type MeetingCarriedOverItem } from "@uniwork/core/meetings/action-items";
import { paths } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { AppLink } from "../../navigation";
import { formatMeetingDay, meetingDayKey, meetingLocale } from "../meeting-datetime";
import { MeetingSectionError } from "../meeting-section-state";
import { useMemberIndex } from "../use-member-index";
import { ConvertedRow, LIST_CLASS } from "./action-item-rows";

interface SourceGroup {
  meeting: MeetingCarriedOverItem["meeting"];
  items: MeetingCarriedOverItem[];
}

/** One group per source meeting, in the order its most pressing task comes (the list is due-sorted). */
function groupBySource(items: readonly MeetingCarriedOverItem[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const item of items) {
    const group = groups.get(item.meeting.id) ?? { meeting: item.meeting, items: [] };
    group.items.push(item);
    groups.set(item.meeting.id, group);
  }
  return [...groups.values()];
}

function CarriedOverGroups({ workspaceId, items }: { workspaceId: string; items: readonly MeetingCarriedOverItem[] }) {
  const { t, i18n } = useTranslation();
  const { memberOf } = useMemberIndex(workspaceId);
  const workspace = useOptionalWorkspace()?.workspace;
  const wsPaths = workspace ? paths.workspace(workspace.organization_slug, workspace.slug) : null;
  return (
    <div className="space-y-4" data-testid="meeting-carried-over">
      {groupBySource(items).map(({ meeting, items: group }) => {
        const title = meeting.title || t("meetings.carriedOver.untitledMeeting");
        const date = meeting.started_at ? formatMeetingDay(meetingDayKey(meeting.started_at), meetingLocale(i18n.language)) : "";
        return (
          <section key={meeting.id} aria-label={t("meetings.carriedOver.fromMeeting", { title })}>
            <h3 className="mb-2 flex flex-wrap items-baseline gap-x-1.5 text-label">
              {wsPaths ? (
                <AppLink href={wsPaths.meeting(meeting.id)} className="font-medium underline-offset-2 hover:underline">
                  {title}
                </AppLink>
              ) : (
                <span className="font-medium">{title}</span>
              )}
              {date ? <span className="text-caption text-muted-foreground">{date}</span> : null}
            </h3>
            <ul className={LIST_CLASS.compact}>
              {group.map((item) => (
                <ConvertedRow
                  key={item.action_item_id}
                  item={{ title: item.task.title ?? "", task: item.task }}
                  variant="compact"
                  taskHref={wsPaths ? wsPaths.task(item.task.id) : null}
                  assigneeName={memberOf(item.task.assignee_id)?.display_name}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * "Carried over from earlier meetings" for the in-room Copilot (spec meeting
 * follow-through D8, §9.2 item 2, follow-4): the open tasks the earlier ended
 * meetings of the same project or series handed out over the last 90 days,
 * folded into one group until opened, grouped by the meeting that did, and
 * how many more lie beyond the page. Nothing renders until there is something
 * to carry, and a failed load says so with a retry instead of vanishing. The
 * detail page draws the same query as `meeting-detail/scheduled/carried-over-brief`.
 * In the room (`room`) the fold is one dashed row under the clerk's list.
 */
export function MeetingCarriedOverSection({
  workspaceId,
  meetingId,
  variant = "compact",
  defaultOpen = false,
}: {
  workspaceId: string;
  meetingId: string;
  variant?: "compact" | "room";
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation();
  const query = useMeetingCarriedOverItems(meetingId);
  const [open, setOpen] = useState(defaultOpen);
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? items.length;
  const more = total - items.length;
  if (query.isError && !query.data) {
    return <MeetingSectionError message={t("meetings.carriedOver.loadFailed")} onRetry={() => void query.refetch()} />;
  }
  if (items.length === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          variant === "room" ? (
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-left text-label font-medium text-foreground hover:bg-surface-hover"
            >
              <RotateCcwClock aria-hidden className="size-4 text-muted-foreground" />
              <span className="flex-1">{t("meetings.panel.actions.carried", { count: total })}</span>
              <ChevronDown
                aria-hidden
                className={cn("size-4 text-faint-foreground transition-transform duration-standard", open && "rotate-180")}
              />
            </button>
          ) : (
            <Button type="button" size="sm" variant="ghost" className="-ml-2 text-muted-foreground">
              {t("meetings.carriedOver.compactToggle", { count: total })}
              <ChevronDown aria-hidden className={cn("transition-transform duration-standard", open && "rotate-180")} />
            </Button>
          )
        }
      />
      <CollapsibleContent>
        <div className="mt-2">
          <CarriedOverGroups workspaceId={workspaceId} items={items} />
          {more > 0 ? <p className="mt-2 text-caption text-muted-foreground">{t("meetings.carriedOver.more", { count: more })}</p> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
