"use client";

import { lazy, Suspense, useState, type ReactNode } from "react";
import { CalendarPlus, ChevronRight, ListPlus, UserPlus, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { useWorkspace } from "../layout/workspace-context";
import { moduleTone } from "../layout/module-tones";
import { AppLink, useNavigation } from "../navigation";
import { NewTaskDialog } from "../tasks/new-task-dialog";

// The task dialog already ships with the top bar's "+ New"; the meeting one
// does not, so it loads only when someone asks for it.
const NewMeetingDialog = lazy(() => import("../meetings/new-meeting-dialog").then((m) => ({ default: m.NewMeetingDialog })));

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
 * surface that says nothing is waiting and offers the first steps — write a
 * task, schedule a meeting (both open their create dialog right here) and,
 * for people who may add members, bring people in.
 */
export function HomeStart() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const { canManageMembers } = usePeoplePermissions(workspace.organization_slug);
  const [creating, setCreating] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  // Mounted from the first open on, so the dialog can animate out.
  const [meetingLoaded, setMeetingLoaded] = useState(false);

  const schedule = () => {
    setMeetingLoaded(true);
    setScheduling(true);
  };

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
          <button type="button" className={ROW} aria-haspopup="dialog" onClick={() => setCreating(true)}>
            <StartRow icon={ListPlus} tone={moduleTone("tasks")} title={t("home.start.create_task")} hint={t("home.start.create_task_hint")} />
          </button>
        </li>
        <li>
          <button type="button" className={ROW} aria-haspopup="dialog" onClick={schedule}>
            <StartRow icon={CalendarPlus} tone={moduleTone("meetings")} title={t("home.start.meeting")} hint={t("home.start.meeting_hint")} />
          </button>
        </li>
        {canManageMembers.allowed ? (
          <li>
            <AppLink href={ws.people()} className={ROW}>
              <StartRow icon={UserPlus} tone={moduleTone("people")} title={t("home.start.invite")} hint={t("home.start.invite_hint")} />
            </AppLink>
          </li>
        ) : null}
      </ul>
      <NewTaskDialog workspaceId={workspace.id} open={creating} onOpenChange={setCreating} showTrigger={false} />
      {meetingLoaded ? (
        <Suspense fallback={null}>
          <NewMeetingDialog
            workspaceId={workspace.id}
            open={scheduling}
            onOpenChange={setScheduling}
            showTrigger={false}
            onCreated={(id) => push(ws.meeting(id))}
          />
        </Suspense>
      ) : null}
    </section>
  );
}
