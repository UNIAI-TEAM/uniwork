"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { activityLabelKey, useMeetingActivity } from "@uniwork/core/meetings";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { MeetingPanelCard } from "./meeting-panel-card";

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
  const { t } = useTranslation();
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
      <MeetingPanelCard
        id="activity-heading"
        title={t("meetings.activity")}
        action={
          <CollapsibleTrigger
            render={
              <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 px-2 text-muted-foreground">
                {open ? t("meetings.hideActivity") : t("meetings.showActivity", { count: all.length })}
                <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
              </Button>
            }
          />
        }
      >
        <CollapsibleContent>
          {all.length === 0 ? (
            <p className="text-label text-muted-foreground">{t("meetings.activityEmpty")}</p>
          ) : (
            <>
              <ol className="-mx-4 -mt-4 divide-y divide-border">
                {visible.map((item) => {
                  const from = item.from_state;
                  const to = item.to_state;
                  const showStates = Boolean(from && to && !from.startsWith("01") && !to.startsWith("01"));
                  return (
                    <li key={item.id} className="px-4 py-2.5">
                      <div className="text-body text-foreground">
                        {nameOf(item.actor_id)} {t(activityLabelKey(item.event_type))}
                      </div>
                      {showStates ? (
                        <div className="text-caption text-muted-foreground">
                          {from} → {to}
                        </div>
                      ) : null}
                      <div className="text-caption tabular-nums text-muted-foreground">
                        {new Date(item.occurred_at).toLocaleString("vi-VN", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
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
                  className="mt-2 h-8 px-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowAll(true)}
                >
                  {t("meetings.showAllActivity", { count: all.length })}
                </Button>
              ) : null}
            </>
          )}
        </CollapsibleContent>
      </MeetingPanelCard>
    </Collapsible>
  );
}
