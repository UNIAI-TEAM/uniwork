"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AuditEvent } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { TaskActivityRow } from "./activity-row";

const ACTIVITY_PAGE_SIZE = 50;

export function TaskActivityGroup({
  events,
  actorNames,
  valueNames,
}: {
  events: AuditEvent[];
  actorNames: Map<string, string>;
  valueNames: Map<string, string>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(events.length <= 5);
  const [visible, setVisible] = useState(ACTIVITY_PAGE_SIZE);
  const shown = events.slice(0, visible);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="space-y-2" data-testid="task-activity-group">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-1 text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Chevron aria-hidden />
        {t("tasks.detail.activity_group", { count: events.length })}
      </Button>
      {open ? (
        <div className="space-y-2 pl-1">
          {shown.map((event) => (
            <TaskActivityRow
              key={event.id}
              event={event}
              actorName={actorNames.get(event.actor_id)}
              valueNames={valueNames}
            />
          ))}
          {visible < events.length ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setVisible((current) => current + ACTIVITY_PAGE_SIZE)}
            >
              {t("tasks.detail.activity_more", { count: events.length - visible })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
