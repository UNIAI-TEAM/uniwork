"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { ListTodo } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useCompleteHomeTasks } from "@uniwork/core/home";
import { paths } from "@uniwork/core/paths";
import type { Task } from "@uniwork/core/types";
import type { HomeSummary } from "@uniwork/core/types/home";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Kbd } from "@uniwork/ui/components/ui/kbd";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { PanelCard } from "../common/panel-card";
import { CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink, useNavigation } from "../navigation";
import { HomeMyWorkRow } from "./home-my-work-row";
import { HomePartialNotice } from "./home-partial-notice";

const KEY_HINTS: [string, string][] = [
  ["J/K", "home.mywork.keys_move"],
  ["X", "home.mywork.keys_select"],
  ["C", "home.mywork.keys_complete"],
  ["O", "home.mywork.keys_open"],
];

/**
 * Open work assigned to the viewer. The list is a listbox: J/K or the arrows
 * move, X selects, C completes, O or Enter opens — handled on the list, not
 * the window, so the keys never fight a shortcut elsewhere on the page.
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
  const [checked, setChecked] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [completing, setCompleting] = useState<string[]>([]);

  const tasks = useMemo(() => summary?.my_work ?? [], [summary]);
  const open = useMemo(() => tasks.filter((task) => task.status !== "done"), [tasks]);

  useEffect(() => {
    setChecked((prev) => prev.filter((id) => open.some((task) => task.id === id)));
    setSelectedId((prev) => (prev && tasks.some((task) => task.id === prev) ? prev : null));
  }, [open, tasks]);

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

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (tasks.length === 0 || e.metaKey || e.ctrlKey || e.altKey) return;
    const idx = tasks.findIndex((task) => task.id === selectedId);
    const current = idx >= 0 ? tasks[idx] : undefined;
    const move = (next: number) => {
      const task = tasks[Math.max(0, Math.min(tasks.length - 1, next))];
      if (!task) return;
      setSelectedId(task.id);
      document.getElementById(`home-task-${task.id}`)?.scrollIntoView({ block: "nearest" });
    };
    switch (e.key) {
      case "j":
      case "ArrowDown":
        e.preventDefault();
        move(idx + 1);
        return;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        move(idx < 0 ? 0 : idx - 1);
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
      case "Enter":
        if (current && e.target === e.currentTarget) {
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
      flush
      className="h-full"
      action={
        <>
          <span className="hidden items-center gap-2 text-caption text-muted-foreground lg:flex">
            {KEY_HINTS.map(([key, label]) => (
              <span key={key} className="flex items-center gap-1">
                <Kbd>{key}</Kbd>
                {t(label)}
              </span>
            ))}
          </span>
          <AppLink href={ws.myTasks()} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {t("home.mywork.view_all")}
          </AppLink>
        </>
      }
    >
      {summary?.partial.includes("tasks") ? <HomePartialNotice source="tasks" onRetry={onRetry} retrying={retrying} /> : null}
      {open.length > 1 ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
          <Checkbox
            checked={allChecked}
            indeterminate={checked.length > 0 && !allChecked}
            onCheckedChange={(value) => setChecked(value === true ? open.map((task) => task.id) : [])}
            aria-label={t("home.mywork.select_all")}
          />
          <span className="text-caption text-muted-foreground">
            {t("home.mywork.selected", { count: checked.length, total: open.length })}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {checked.length > 0 ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setChecked([])}>
                {t("home.mywork.clear_selection")}
              </Button>
            ) : null}
            <Button type="button" size="sm" disabled={checked.length === 0 || complete.isPending} onClick={() => run(checked)}>
              {t("home.mywork.bulk_complete", { count: checked.length })}
            </Button>
          </div>
        </div>
      ) : null}
      {loading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <CollectionPageState
          className="py-8"
          icon={ListTodo}
          tone={moduleTone("my_tasks")}
          title={t("home.mywork.empty_title")}
          description={t("home.mywork.empty_description")}
          actions={
            <AppLink href={ws.tasks()} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("home.mywork.empty_action")}
            </AppLink>
          }
        />
      ) : (
        <ul
          role="listbox"
          tabIndex={0}
          aria-label={t("home.section.mywork")}
          aria-activedescendant={selectedId ? `home-task-${selectedId}` : undefined}
          onKeyDown={onKeyDown}
          className="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {tasks.map((task) => (
            <HomeMyWorkRow
              key={task.id}
              task={task}
              today={summary?.today ?? ""}
              href={ws.task(task.id)}
              selected={task.id === selectedId}
              checked={checked.includes(task.id)}
              completing={completing.includes(task.id)}
              onCheckedChange={toggle}
              onComplete={(target) => run([target.id])}
            />
          ))}
        </ul>
      )}
    </PanelCard>
  );
}
