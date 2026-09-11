"use client";

import { ChevronDown, History } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { activityLabelKey, useMeetingActivity } from "@uniwork/core/meetings";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { cn } from "@uniwork/ui/lib/utils";
import { PanelCard } from "../common/panel-card";
import { MeetingPersonAvatar } from "./meeting-person";
import { meetingLocale } from "./meeting-datetime";

const VISIBLE_ACTIVITY_LIMIT = 5;

export function MeetingActivityTimeline({
  workspaceId,
  meetingId,
  defaultOpen = false,
}: {
  workspaceId: string;
  meetingId: string;
  defaultOpen?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data: items } = useMeetingActivity(meetingId);
  const { data: members } = useMembers(workspaceId);
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);
  const nameOf = (id: string) => members?.find((m) => m.user_id === id)?.display_name ?? id;
  const all = items ?? [];
  const visible = showAll ? all : all.slice(0, VISIBLE_ACTIVITY_LIMIT);
  const hiddenCount = Math.max(0, all.length - VISIBLE_ACTIVITY_LIMIT);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <PanelCard
        id="activity-heading"
        icon={History}
        title={t("meetings.activity")}
        flush
        action={
          <CollapsibleTrigger
            render={
              <Button type="button" size="sm" variant="ghost" className="text-muted-foreground">
                {open ? t("meetings.hideActivity") : t("meetings.showActivity", { count: all.length })}
                <ChevronDown
                  className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")}
                  aria-hidden
                />
              </Button>
            }
          />
        }
      >
        <CollapsibleContent>
          {all.length === 0 ? (
            <p className="px-4 py-6 text-center text-label text-muted-foreground">{t("meetings.activityEmpty")}</p>
          ) : (
            <div className="px-4 py-4">
              <ol className="relative space-y-4 before:absolute before:bottom-3 before:left-3 before:top-3 before:w-px before:bg-border">
                {visible.map((item) => {
                  const from = item.from_state;
                  const to = item.to_state;
                  const showStates = Boolean(from && to && !from.startsWith("01") && !to.startsWith("01"));
                  const actor = nameOf(item.actor_id);
                  return (
                    <li key={item.id} className="relative flex min-w-0 items-start gap-3">
                      <MeetingPersonAvatar name={actor} size="sm" className="relative ring-4 ring-surface" />
                      <div className="min-w-0 flex-1 pt-0.5">
                        <p className="text-body text-foreground">
                          <span className="font-medium">{actor}</span> {t(activityLabelKey(item.event_type))}
                        </p>
                        <p className="mt-0.5 flex flex-wrap gap-x-2 text-caption tabular-nums text-muted-foreground">
                          <span>
                            {new Date(item.occurred_at).toLocaleString(meetingLocale(i18n.language), {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </span>
                          {showStates ? (
                            <span>
                              {from} → {to}
                            </span>
                          ) : null}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {hiddenCount > 0 && !showAll ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3 ml-9 px-2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowAll(true)}
                >
                  {t("meetings.showAllActivity", { count: all.length })}
                </Button>
              ) : null}
            </div>
          )}
        </CollapsibleContent>
      </PanelCard>
    </Collapsible>
  );
}
