"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { House, RefreshCw, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { buildHomeBrief, overdueDays } from "@uniwork/core/home/brief";
import { useHomePrefs, useHomeSummary } from "@uniwork/core/home";
import { visibleSections, type HomeSectionKey } from "@uniwork/core/home/prefs";
import type { HomeSummary } from "@uniwork/core/types/home";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageHeader, CollectionPageHeaderAction, CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { formatMeetingDay, meetingDayKey, meetingLocale } from "../meetings/meeting-datetime";
import { HomeBrief } from "./home-brief";
import { HomeCustomizePanel } from "./home-customize-panel";
import { HomeInbox } from "./home-inbox";
import { homeBalancedBands, homeGridClass, homeSpanClass } from "./home-layout";
import { HomeMyWork } from "./home-my-work";
import { HomeStats, type HomeWorkStat } from "./home-stats";
import { HomeUpcoming } from "./home-upcoming";

function greetingKey(hour: number): "morning" | "noon" | "afternoon" | "evening" {
  if (hour < 11) return "morning";
  if (hour < 14) return "noon";
  if (hour < 18) return "afternoon";
  return "evening";
}

function HomeGreeting({ name, summary }: { name: string; summary: HomeSummary | undefined }) {
  const { t, i18n } = useTranslation();
  const attention = summary ? summary.counts.overdue + summary.counts.due_today + summary.counts.meetings_today : 0;
  const subtitle = !summary
    ? t("home.subtitle.loading")
    : attention > 0
      ? t("home.subtitle.attention", { count: attention })
      : t("home.subtitle.clear");
  // The server's "today" is in the person's zone; before it arrives, the browser's day.
  const day = formatMeetingDay(summary?.today ?? meetingDayKey(new Date().toISOString()), meetingLocale(i18n.language));
  return (
    <div className="pt-1">
      <p className="text-overline text-muted-foreground">{day}</p>
      <h2 className="mt-1.5 text-display-sm font-semibold text-balance text-foreground">
        {t(`home.greeting.${greetingKey(new Date().getHours())}`, { name })}
      </h2>
      <p className="mt-1 max-w-prose text-body-lg text-pretty text-muted-foreground">{subtitle}</p>
    </div>
  );
}

/**
 * The workspace home: today at a glance, the viewer's open work, meetings,
 * unread notifications and a brief, arranged by the viewer's own layout.
 * One request feeds every section; a failed source is labelled in its section
 * while the others keep working.
 */
export function HomeView() {
  const { t } = useTranslation();
  const { workspace, user } = useWorkspace();
  const summaryQuery = useHomeSummary(workspace.id);
  const { prefs, saving, failed, update, reset } = useHomePrefs(workspace.id);
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => {
    if (failed) toast.error(t("home.customize.save_failed"));
  }, [failed, t]);

  const summary = summaryQuery.data ?? undefined;
  const loading = summaryQuery.isPending;
  const retrying = summaryQuery.isFetching;
  const retry = () => void summaryQuery.refetch();
  const unusable = summaryQuery.isError || summaryQuery.data === null;
  const briefLines = useMemo(() => (summary ? buildHomeBrief(summary) : []), [summary]);
  // A brief with nothing to say is absent, so the layout never keeps a hole for it.
  const enabled = visibleSections(prefs);
  const visible = enabled.filter((key) => key !== "brief" || briefLines.length > 0);

  // Overdue and due today have no filtered list elsewhere to land on, so they
  // land on the first such task in My work here.
  const showWork = (stat: HomeWorkStat) => {
    const target = summary?.my_work.find((task) =>
      stat === "overdue" ? overdueDays(summary.today, task.due_date) > 0 : task.due_date === summary.today,
    );
    const link = target ? document.querySelector<HTMLElement>(`[data-task-id="${target.id}"] a`) : null;
    if (link) link.focus();
    else document.getElementById("home-mywork")?.scrollIntoView({ block: "start" });
  };

  const sectionProps = { summary, loading, retrying, onRetry: retry };
  const sections: Record<HomeSectionKey, ReactNode> = {
    stats: <HomeStats counts={summary?.counts} loading={loading} onShowWork={visible.includes("mywork") ? showWork : undefined} />,
    mywork: <HomeMyWork {...sectionProps} />,
    upcoming: <HomeUpcoming {...sectionProps} />,
    inbox: <HomeInbox {...sectionProps} />,
    brief: <HomeBrief lines={briefLines} />,
  };

  const layout = prefs.layout;
  const grid =
    layout === "balanced" ? (
      homeBalancedBands(visible).map((band, index) =>
        band.kind === "row" ? (
          <div key={band.key} className="min-w-0">
            {sections[band.key]}
          </div>
        ) : (
          <div
            key={`split-${index}`}
            className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] xl:items-start"
          >
            {[band.main, band.aside].map((column, i) => (
              // Below xl the column dissolves and its sections join the band's own flow.
              <div key={i} className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
                {column.map(({ key, orderClass }) => (
                  <div key={key} className={cn("min-w-0 xl:order-none", orderClass)}>
                    {sections[key]}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ),
      )
    ) : (
      <div className={homeGridClass(layout)}>
        {visible.map((key) => (
          <div key={key} className={homeSpanClass(key, layout)}>
            {sections[key]}
          </div>
        ))}
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={House}
        tone={moduleTone("home")}
        title={t("home.title")}
        actions={
          <>
            <CollectionPageHeaderAction
              icon={SlidersHorizontal}
              label={t("home.actions.customize")}
              aria-expanded={customizing}
              aria-controls={customizing ? "home-customize" : undefined}
              onClick={() => setCustomizing((open) => !open)}
            />
            <CollectionPageHeaderAction icon={RefreshCw} label={t("home.actions.refresh")} disabled={retrying} onClick={retry} />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl space-y-5 px-4 pt-6 pb-10 md:px-6">
          <HomeGreeting name={user.display_name} summary={summary} />
          {customizing ? (
            <HomeCustomizePanel prefs={prefs} saving={saving} onChange={update} onReset={reset} onClose={() => setCustomizing(false)} />
          ) : null}
          {unusable ? (
            <CollectionPageState
              role="alert"
              icon={TriangleAlert}
              title={t("home.error.title")}
              description={t("home.error.description")}
              actions={
                <Button type="button" variant="outline" size="sm" disabled={retrying} onClick={retry}>
                  {t("home.error.retry")}
                </Button>
              }
            />
          ) : enabled.length === 0 ? (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border p-6 text-body text-muted-foreground">
              <span>{t("home.customize.all_hidden")}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setCustomizing(true)}>
                {t("home.customize.open")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">{grid}</div>
          )}
        </div>
      </div>
    </div>
  );
}
