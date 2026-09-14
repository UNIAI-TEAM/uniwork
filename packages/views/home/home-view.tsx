"use client";

import { useEffect, useState, type ReactNode } from "react";
import { House, RefreshCw, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { overdueDays } from "@uniwork/core/home/brief";
import { useHomePrefs, useHomeSummary } from "@uniwork/core/home";
import { visibleSections, type HomeSectionKey } from "@uniwork/core/home/prefs";
import type { HomeSummary } from "@uniwork/core/types/home";
import { Button } from "@uniwork/ui/components/ui/button";
import { CollectionPageHeader, CollectionPageHeaderAction, CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { HomeBrief } from "./home-brief";
import { HomeCustomizePanel } from "./home-customize-panel";
import { HomeInbox } from "./home-inbox";
import { homeGridClass, homeSpanClass } from "./home-layout";
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
  const { t } = useTranslation();
  const attention = summary ? summary.counts.overdue + summary.counts.due_today + summary.counts.meetings_today : 0;
  const subtitle = !summary
    ? t("home.subtitle.loading")
    : attention > 0
      ? t("home.subtitle.attention", { count: attention })
      : t("home.subtitle.clear");
  return (
    <div>
      <h2 className="text-title font-semibold text-foreground">{t(`home.greeting.${greetingKey(new Date().getHours())}`, { name })}</h2>
      <p className="mt-1 text-body text-muted-foreground">{subtitle}</p>
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
  const visible = visibleSections(prefs);

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
    brief: summary ? <HomeBrief summary={summary} /> : null,
  };

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
        <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6">
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
          ) : visible.length === 0 ? (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border p-6 text-body text-muted-foreground">
              <span>{t("home.customize.all_hidden")}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setCustomizing(true)}>
                {t("home.customize.open")}
              </Button>
            </div>
          ) : (
            <div className={homeGridClass(prefs.layout)}>
              {visible.map((key) =>
                sections[key] ? (
                  <div key={key} className={homeSpanClass(key, prefs.layout)}>
                    {sections[key]}
                  </div>
                ) : null,
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
