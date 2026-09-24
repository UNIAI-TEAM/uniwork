"use client";

import { useState, type ReactNode } from "react";
import { CalendarPlus, ChevronRight, ListPlus, UserPlus, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { useWorkspace } from "../layout/workspace-context";
import { moduleTone } from "../layout/module-tones";
import { AppLink } from "../navigation";
import { NewTaskDialog } from "../tasks/new-task-dialog";

const ROW =
  "group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-hover active:bg-surface-selected";

function StartRow({ icon, tone, title, hint }: { icon: LucideIcon; tone: IconTileTone; title: string; hint: string }): ReactNode {
  return (
    <>
      <IconTile icon={icon} tone={tone} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body font-medium text-foreground">{title}</span>
        <span className="text-caption text-pretty text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
      />
    </>
  );
}

/**
 * What a new or quiet workspace shows instead of three empty lists: one
 * surface that says nothing is waiting and offers the three first steps —
 * write a task, schedule a meeting, bring people in.
 */
export function HomeStart() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const [creating, setCreating] = useState(false);

  return (
    <section
      aria-labelledby="home-start-title"
      className="max-w-3xl overflow-hidden rounded-xl border border-surface-border bg-surface shadow-[var(--surface-shadow)]"
    >
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <h2 id="home-start-title" className="text-title-sm font-semibold text-balance text-foreground">
          {t("home.start.title")}
        </h2>
        <p className="mt-1 max-w-prose text-body text-pretty text-muted-foreground">{t("home.start.description")}</p>
      </div>
      <ul className="divide-y divide-border">
        <li>
          <button type="button" className={ROW} onClick={() => setCreating(true)}>
            <StartRow icon={ListPlus} tone={moduleTone("tasks")} title={t("home.start.create_task")} hint={t("home.start.create_task_hint")} />
          </button>
        </li>
        <li>
          <AppLink href={ws.meetings()} className={ROW}>
            <StartRow icon={CalendarPlus} tone={moduleTone("meetings")} title={t("home.start.meeting")} hint={t("home.start.meeting_hint")} />
          </AppLink>
        </li>
        <li>
          <AppLink href={ws.people()} className={ROW}>
            <StartRow icon={UserPlus} tone={moduleTone("people")} title={t("home.start.invite")} hint={t("home.start.invite_hint")} />
          </AppLink>
        </li>
      </ul>
      <NewTaskDialog workspaceId={workspace.id} open={creating} onOpenChange={setCreating} showTrigger={false} />
    </section>
  );
}
