"use client";

import { useId, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Columns3, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { useChildTaskProgress, useCreateTask, useDeleteTask, useSetTaskParent, useTaskChildren } from "@uniwork/core/tasks";
import { useSubtaskDisplayStore } from "@uniwork/core/tasks/stores/subtask-display-store";
import { useSubtasksCollapsed, useTaskDetailUiStore } from "@uniwork/core/tasks/stores/task-detail-ui-store";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { Input } from "@uniwork/ui/components/ui/input";
import { useWorkspace } from "../../../layout/workspace-context";
import { toastApiError } from "../../../toast-api-error";
import { SubtaskRow } from "./subtask-row";

export function TaskDetailSubtasksSection({ workspaceId, taskId }: { workspaceId: string; taskId: string }) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { data: children = [], isLoading } = useTaskChildren(taskId);
  const { data: progressRows = [] } = useChildTaskProgress(workspaceId);
  const create = useCreateTask(workspaceId);
  const remove = useDeleteTask(workspaceId);
  const setParent = useSetTaskParent(workspaceId);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const fields = useSubtaskDisplayStore((state) => state.fields);
  const toggleField = useSubtaskDisplayStore((state) => state.toggle);
  const collapsed = useSubtasksCollapsed(taskId);
  const regionId = useId();
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const progress = progressRows.find((row) => row.parent_task_id === taskId);
  const done = progress?.done ?? children.filter((child) => child.status === "done").length;
  const total = progress?.total ?? children.length;
  const hasStage = children.some((child) => child.stage != null);
  const groups = useMemo(() => {
    const map = new Map<number | null, typeof children>();
    for (const child of children) map.set(child.stage ?? null, [...(map.get(child.stage ?? null) ?? []), child]);
    return [...map.entries()].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b));
  }, [children]);
  const allSelected = children.length > 0 && selected.size === children.length;

  const onCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      const created = await create.mutateAsync({ title: trimmed });
      if (!created) throw new Error("create failed");
      await setParent.mutateAsync({ taskId: created.id, body: { parent_task_id: taskId } });
      setTitle("");
    } catch (error) {
      toastApiError(error, t("common.error"));
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-label={t("tasks.detail.section_subtasks")} className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon-sm" aria-expanded={!collapsed} aria-controls={regionId} aria-label={t("tasks.detail.subtasks_toggle")} onClick={() => useTaskDetailUiStore.getState().setSubtasksCollapsed(taskId, !collapsed)}><Chevron aria-hidden /></Button>
          <h2 className="text-body font-semibold text-foreground">{t("tasks.detail.section_subtasks")}</h2>
          <span data-testid="subtasks-progress" className="text-caption text-muted-foreground">{t("tasks.detail.subtasks_progress", { done, total })}</span>
        </div>
        <div className="flex items-center gap-1">
          {children.length > 0 ? <Button type="button" variant="ghost" size="icon-sm" aria-label={t("tasks.detail.subtask_add_button")} onClick={() => document.getElementById(`${regionId}-input`)?.focus()}><Plus aria-hidden /></Button> : null}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t("tasks.detail.subtask_display_settings")} />}><Columns3 aria-hidden /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuCheckboxItem checked={fields.priority} onCheckedChange={() => toggleField("priority")}>{t("tasks.priority")}</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={fields.labels} onCheckedChange={() => toggleField("labels")}>{t("tasks.detail.prop_labels")}</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={fields.progress} onCheckedChange={() => toggleField("progress")}>{t("tasks.detail.subtasks_progress_label")}</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={fields.dueDate} onCheckedChange={() => toggleField("dueDate")}>{t("tasks.due_date")}</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={fields.assignee} onCheckedChange={() => toggleField("assignee")}>{t("tasks.assignee")}</DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div id={regionId} hidden={collapsed}>
        {isLoading ? <p className="text-caption text-muted-foreground">{t("common.loading")}</p> : children.length === 0 ? <p className="text-caption text-muted-foreground">{t("tasks.detail.subtasks_empty")}</p> : (
          <div className="overflow-hidden rounded-lg border border-border/70 bg-card/30">
            <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-2 py-1.5 text-caption text-muted-foreground">
              <Checkbox checked={allSelected} indeterminate={selected.size > 0 && !allSelected} onCheckedChange={(checked) => setSelected(checked ? new Set(children.map((child) => child.id)) : new Set())} aria-label={t("tasks.detail.subtask_select_all")} />
              <span>{selected.size > 0 ? t("tasks.detail.subtask_selected", { count: selected.size }) : t("tasks.detail.subtask_list")}</span>
              {selected.size > 0 ? <Button type="button" variant="ghost" size="icon-xs" className="ml-auto" aria-label={t("common.delete")} onClick={() => { void Promise.all([...selected].map((id) => remove.mutateAsync(id))).then(() => setSelected(new Set())).catch((error) => toastApiError(error, t("common.error"))); }}><Trash2 aria-hidden /></Button> : null}
            </div>
            <ul>{groups.map(([stage, stageChildren]) => <li key={stage ?? "none"}>
              {hasStage ? <h3 className="border-b border-border/60 bg-muted/40 px-2 py-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground">{stage === null ? t("tasks.detail.stage_none") : t("tasks.detail.stage_group", { stage })}</h3> : null}
              <ul className="divide-y divide-border/60">{stageChildren.map((child) => <SubtaskRow key={child.id} task={child} workspaceId={workspaceId} href={paths.workspace(workspace.organization_slug, workspace.slug).task(child.id)} selected={selected.has(child.id)} onSelect={(checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(child.id); else next.delete(child.id); return next; })} show={fields} childProgress={progressRows.find((row) => row.parent_task_id === child.id)} onDelete={() => { void remove.mutateAsync(child.id).catch((error) => toastApiError(error, t("common.error"))); }} />)}</ul>
            </li>)}</ul>
          </div>
        )}
        <form className="mt-3 flex gap-2" onSubmit={(event) => void onCreate(event)}>
          <Input id={`${regionId}-input`} aria-label={t("tasks.detail.add_subtask")} placeholder={t("tasks.detail.add_subtask_placeholder")} value={title} onChange={(event) => setTitle(event.target.value)} disabled={pending} />
          <Button type="submit" disabled={pending || !title.trim()}>{t("tasks.detail.add_subtask_action")}</Button>
        </form>
      </div>
    </section>
  );
}
