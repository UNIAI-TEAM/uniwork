"use client";

import { ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HomeBriefLine } from "@uniwork/core/home/brief";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { PanelCard } from "../common/panel-card";
import { moduleTone } from "../layout/module-tones";
import { HOME_MARKS, type HomeMarkKey } from "./home-marks";

/** `home.brief.<topic>[_plain]` → the stat the sentence explains. */
const TOPIC_MARK: Record<string, HomeMarkKey> = {
  overdue: "overdue",
  meetings: "meetings_today",
  due_today: "due_today",
  unread: "unread",
};

function markOf(line: HomeBriefLine): HomeMarkKey | undefined {
  const topic = line.key.replace(/^home\.brief\./, "").replace(/_plain$/, "");
  return TOPIC_MARK[topic];
}

/**
 * A few sentences derived from the summary itself — no model, no invented
 * numbers. Each carries the mark of the stat it explains. The view leaves the
 * section out when there is nothing to say, rather than show a line of zeros.
 */
export function HomeBrief({ lines }: { lines: HomeBriefLine[] }) {
  const { t } = useTranslation();
  return (
    <PanelCard
      id="home-brief"
      title={t("home.brief.title")}
      icon={ClipboardList}
      iconTone={moduleTone("home")}
      className="h-full"
      action={<span className="rounded-md bg-muted px-1.5 py-0.5 text-micro font-medium text-muted-foreground">{t("home.brief.badge")}</span>}
    >
      <ul className="space-y-3">
        {lines.map((line) => {
          const mark = markOf(line);
          return (
            <li key={line.key} className="flex items-start gap-2.5 text-body text-foreground">
              {mark ? (
                <IconTile icon={HOME_MARKS[mark].icon} tone={HOME_MARKS[mark].tone} size="xs" shape="circle" className="mt-px" />
              ) : null}
              <span className="min-w-0 text-pretty">{t(line.key, line.params)}</span>
            </li>
          );
        })}
      </ul>
    </PanelCard>
  );
}
