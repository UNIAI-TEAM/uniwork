"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, ListTodo } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useCompleteHomeTasks } from "@uniwork/core/home";
import { overdueDays } from "@uniwork/core/home/brief";
import { paths } from "@uniwork/core/paths";
import type { Task } from "@uniwork/core/types";
import type { HomeSummary } from "@uniwork/core/types/home";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Kbd } from "@uniwork/ui/components/ui/kbd";
import { cn } from "@uniwork/ui/lib/utils";
import { PanelCard } from "../common/panel-card";
import { CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink, useNavigation } from "../navigation";
import { HomeMyWorkRow } from "./home-my-work-row";
import { HomePartialNotice } from "./home-partial-notice";
import { HomeTaskRowsSkeleton } from "./home-skeletons";

type DueGroup = "overdue" | "today" | "later" | "none";

function dueGroup(task: Task, today: string): DueGroup {
  if (!task.due_date) return "none";
  if (overdueDays(today, task.due_date) > 0) return "overdue";
  return task.due_date === today ? "today" : "later";
}

/**
 * The server sends my work most urgent first — overdue, due today, later,
 * undated — so each group is one consecutive run and cutting the list at
 * group changes keeps the order the keyboard walks.
 */
function groupRuns(tasks: Task[], today: string): { group: DueGroup; tasks: Task[] }[] {
  const runs: { group: DueGroup; tasks: Task[] }[] = [];
  for (const task of tasks) {
    const group = dueGroup(task, today);
    const last = runs[runs.length - 1];
    if (last && last.group === group) last.tasks.push(task);
    else runs.push({ group, tasks: [task] });
  }
  return runs;
}

const KEY_HINTS: [string, string][] = [
  ["J/K", "home.mywork.keys_move"],
  ["X", "home.mywork.keys_select"],
  ["C", "home.mywork.keys_complete"],
  ["O", "home.mywork.keys_open"],
];

/**
 * Open work assigned to the viewer. With focus anywhere in a row, J/K or the
 * arrows move focus to the next or previous task, X selects it, C completes it
 * and O opens it (Enter already follows the focused link). The keys are read on
 * the list, not the window, so they never fight a shortcut elsewhere; the list
 * stays a plain list so the checkbox, link and button in each row keep their
 * own roles for screen readers. Rows sit under a due heading when there is
 * more than one kind of due; the key hints show while focus is in the card.
 * The server sends at most a page of work, so a footer says how much more
 * there is and where it lives.
 */
export function HomeMyWork({
  summary,
  loading,
  retrying,
  onRetry,
}: {
  summary: HomeSummary | undefined;
  loading: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const complete = useCompleteHomeTasks(workspace.id);
  const listRef = useRef<HTMLUListElement>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [completing, setCompleting] = useState<string[]>([]);

  const tasks = useMemo(() => summary?.my_work ?? [], [summary]);
  const today = summary?.today ?? "";
  const runs = useMemo(() => groupRuns(tasks, today), [tasks, today]);
  const failed = summary?.partial.includes("tasks") ?? false;
  const more = Math.max(0, (summary?.counts.open ?? 0) - tasks.length);
  const open = useMemo(() => tasks.filter((task) => task.status !== "done"), [tasks]);

  useEffect(() => {
    setChecked((prev) => {
      const next = prev.filter((id) => open.some((task) => task.id === id));
      return next.length === prev.length ? prev : next;
    });
  }, [open]);

  const run = (ids: string[]) => {
    if (ids.length === 0) return;
    setCompleting((prev) => [...prev, ...ids]);
    complete.mutate(ids, {
      onSuccess: () => {
        toast.success(t("home.mywork.completed_toast", { count: ids.length }));
        setChecked((prev) => prev.filter((id) => !ids.includes(id)));
      },
      onError: () => toast.error(t("home.mywork.complete_failed")),
      onSettled: () => setCompleting((prev) => prev.filter((id) => !ids.includes(id))),
    });
  };

  const toggle = (task: Task, next: boolean) =>
    setChecked((prev) => (next ? [...new Set([...prev, task.id])] : prev.filter((id) => id !== task.id)));

  const rowIndex = (target: EventTarget | null) => {
    const id = target instanceof HTMLElement ? target.closest<HTMLElement>("[data-task-id]")?.dataset.taskId : undefined;
    return id ? tasks.findIndex((task) => task.id === id) : -1;
  };

  const focusRow = (index: number) => {
    const task = tasks[Math.max(0, Math.min(tasks.length - 1, index))];
    if (!task) return;
    listRef.current?.querySelector<HTMLElement>(`[data-task-id="${task.id}"] a`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (tasks.length === 0 || e.metaKey || e.ctrlKey || e.altKey) return;
    const idx = rowIndex(e.target);
    const current = idx >= 0 ? tasks[idx] : undefined;
    switch (e.key) {
      case "j":
      case "ArrowDown":
        e.preventDefault();
        focusRow(idx + 1);
        return;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        focusRow(idx <= 0 ? 0 : idx - 1);
        return;
      case "x":
        if (current && current.status !== "done") {
          e.preventDefault();
          toggle(current, !checked.includes(current.id));
        }
        return;
      case "c":
        if (current && current.status !== "done") {
          e.preventDefault();
          run([current.id]);
        }
        return;
      case "o":
        if (current) {
          e.preventDefault();
          push(ws.task(current.id));
        }
        return;
      default:
        return;
    }
  };

  const allChecked = open.length > 0 && checked.length === open.length;

  return (
    <PanelCard
      id="home-mywork"
      title={t("home.section.mywork")}
      icon={ListTodo}
      iconTone={moduleTone("my_tasks")}
      flush
      // The card is a size container: its width depends on the chosen density,
      // not on the viewport, so what fits in its header is decided per card.
      className="group/mywork @container"
      action={
        <>
          <span
            className={cn(
              "hidden items-center gap-2 text-caption text-muted-foreground",
              tasks.length > 0 && "@2xl:group-focus-within/mywork:flex",
            )}
          >
            {KEY_HINTS.map(([key, label]) => (
              <span key={key} className="flex items-center gap-1">
                <Kbd>{key}</Kbd>
                {t(label)}
              </span>
            ))}
          </span>
          <AppLink href={ws.myTasks()} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            {t("home.mywork.view_all")}
            <ArrowRight aria-hidden data-icon="inline-end" />
          </AppLink>
        </>
      }
    >
      {failed ? <HomePartialNotice source="tasks" onRetry={onRetry} retrying={retrying} /> : null}
      {/* The selection bar exists once something is selected; a row's box or X starts it. */}
      {checked.length > 0 ? (
        <div className="flex min-h-11 flex-wrap items-center gap-3 border-b border-border bg-brand-subtle px-4 py-1.5">
          <Checkbox
            checked={allChecked}
            indeterminate={checked.length > 0 && !allChecked}
            onCheckedChange={(value) => setChecked(value === true ? open.map((task) => task.id) : [])}
            aria-label={t("home.mywork.select_all")}
          />
          <span className="text-caption font-medium text-brand-subtle-foreground tabular-nums">
            {t("home.mywork.selected", { count: checked.length, total: open.length })}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setChecked([])}>
              {t("home.mywork.clear_selection")}
            </Button>
            <Button type="button" size="sm" disabled={complete.isPending} onClick={() => run(checked)}>
              {t("home.mywork.bulk_complete", { count: checked.length })}
            </Button>
          </div>
        </div>
      ) : null}
      {loading ? (
        <HomeTaskRowsSkeleton />
      ) : tasks.length === 0 && failed ? null : tasks.length === 0 ? (
        <CollectionPageState
          className="py-6"
          icon={ListTodo}
          tone={moduleTone("my_tasks")}
          title={t("home.mywork.empty_title")}
          description={t("home.mywork.empty_description")}
          actions={
            <AppLink href={ws.tasks()} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("home.mywork.empty_action")}
            </AppLink>
          }
        />
      ) : (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keys bubble up from the row controls; the list itself takes no focus
        <ul ref={listRef} aria-label={t("home.section.mywork")} onKeyDown={onKeyDown}>
          {runs.map((groupRun) => {
            const rows = groupRun.tasks.map((task) => (
              <HomeMyWorkRow
                key={task.id}
                task={task}
                today={today}
                href={ws.task(task.id)}
                checked={checked.includes(task.id)}
                completing={completing.includes(task.id)}
                onCheckedChange={toggle}
                onComplete={(target) => run([target.id])}
              />
            ));
            if (runs.length === 1) return <Fragment key={groupRun.group}>{rows}</Fragment>;
            const label = t(`home.mywork.group.${groupRun.group}`);
            return (
              <li key={groupRun.group} className="border-b border-border last:border-b-0">
                <h3
                  className={cn(
                    "px-4 pt-3 pb-1 text-caption font-medium",
                    groupRun.group === "overdue" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {label}
                </h3>
                <ul aria-label={label}>{rows}</ul>
              </li>
            );
          })}
        </ul>
      )}
      {more > 0 && !loading ? (
        <AppLink
          href={ws.myTasks()}
          className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-label text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground"
        >
          {t("home.mywork.more", { count: more })}
          <ArrowRight aria-hidden className="size-4" />
        </AppLink>
      ) : null}
    </PanelCard>
  );
}
