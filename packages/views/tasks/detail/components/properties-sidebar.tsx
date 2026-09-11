"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { paths } from "@uniwork/core/paths";
import {
  useAttachTaskLabel,
  useDetachTaskLabel,
  useLabelsOnTask,
  usePutTask,
  useTask,
  useTaskLabels,
  useTaskProperties,
  useUpdateTask,
} from "@uniwork/core/tasks";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type ActorKind,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { AgentBadge } from "../../../agents/agent-badge";
import { DateField } from "../../../common/date-field";
import { PAGE_GUTTER } from "../../../layout/page-header";
import { useWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";
import { toastApiError } from "../../../toast-api-error";
import { cn } from "@uniwork/ui/lib/utils";
import { tintClass } from "@uniwork/ui/components/common/icon-tile";
import { tintFromColor } from "@uniwork/ui/lib/tint-from-color";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

const assigneeValue = (kind: string, id: string) => `${kind}:${id}`;

function parseAssignee(v: string): {
  assignee_id: string | null;
  assignee_kind?: ActorKind;
} {
  const i = v.indexOf(":");
  if (i < 0) return { assignee_id: null };
  return {
    assignee_id: v.slice(i + 1),
    assignee_kind: v.slice(0, i) === "agent" ? "agent" : "human",
  };
}

function PropRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr] items-start gap-x-2 gap-y-1 py-1">
      <div className="pt-1.5 text-caption text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Suite properties sidebar: status/priority via revisioned PUT; assignee and
 * due date via PATCH; labels via attach/detach. Project / stage / start date /
 * custom properties stay visible-disabled until their mutation surface lands.
 */
export function TaskDetailPropertiesSidebar({
  workspaceId,
  task,
  onRefetch,
}: {
  workspaceId: string;
  task: Task;
  onRefetch: () => void;
}) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { data: members } = useMembers(workspaceId);
  const { data: agents } = useWorkspaceAgents(workspaceId);
  const { data: publicConfig } = usePublicConfig();
  const put = usePutTask(workspaceId);
  const update = useUpdateTask(workspaceId);
  const propertiesQuery = useTaskProperties(workspaceId);
  const catalog = propertiesQuery.data?.properties ?? [];
  const labelsQuery = useTaskLabels(workspaceId);
  const onTaskLabels = useLabelsOnTask(task.id);
  const attachLabel = useAttachTaskLabel(workspaceId, task.id);
  const detachLabel = useDetachTaskLabel(workspaceId, task.id);
  const parentId = task.parent_task_id ?? null;
  const { data: parentTask } = useTask(parentId ?? "");
  const [labelId, setLabelId] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);

  const projectsCap = capabilityState(
    publicConfig ?? EMPTY_CONFIG,
    "tasks.projects",
  );
  const projectsDisabled = projectsCap.status !== "available";
  const projectsReason = t(
    projectsCap.explanation_key || "capabilities.surface_not_ready",
  );
  const surfaceNotReady = t("capabilities.surface_not_ready");
  const catalogEmpty = !propertiesQuery.isLoading && catalog.length === 0;

  const attachedIds = useMemo(
    () => new Set((onTaskLabels.data?.labels ?? []).map((l) => l.id)),
    [onTaskLabels.data?.labels],
  );

  const putField = (patch: { status?: string; priority?: string }) => {
    put.mutate(
      {
        taskId: task.id,
        body: { ...patch, revision: task.revision },
        ifMatch: String(task.revision),
      },
      {
        onSuccess: (data) => {
          if (data == null) onRefetch();
        },
        onError: (err) => {
          toastApiError(err, t("common.error"));
          onRefetch();
        },
      },
    );
  };

  const patchField = (
    patch: Parameters<typeof update.mutate>[0]["patch"],
  ) => {
    update.mutate(
      { taskId: task.id, patch },
      {
        onError: (err) => toastApiError(err, t("common.error")),
      },
    );
  };

  const parentHref = parentTask
    ? paths.workspace(workspace.organization_slug, workspace.slug).task(parentTask.id)
    : null;

  return (
    <aside
      aria-label={t("tasks.detail.properties_sidebar")}
      className={`h-full overflow-y-auto py-4 ${PAGE_GUTTER}`}
    >
      {parentId ? (
        <section className="mb-4">
          <h2 className="mb-2 text-caption font-medium text-muted-foreground">
            {t("tasks.detail.section_parent")}
          </h2>
          {parentHref && parentTask ? (
            <AppLink
              href={parentHref}
              className="block truncate text-caption text-foreground hover:underline"
            >
              <span className="text-muted-foreground">
                {parentTask.identifier || parentTask.id}
              </span>{" "}
              {parentTask.title}
            </AppLink>
          ) : (
            <p className="text-caption text-muted-foreground">{parentId}</p>
          )}
        </section>
      ) : null}

      <h2 className="mb-2 text-caption font-medium text-muted-foreground">
        {t("tasks.detail.section_properties")}
      </h2>

      <div className="space-y-0.5">
        <PropRow label={<Label>{t("tasks.status")}</Label>}>
          <DropdownMenu open={statusOpen} onOpenChange={setStatusOpen}>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start px-2"
                  aria-label={t("tasks.status")}
                />
              }
            >
              {t(`tasks.status_${task.status}`)}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={task.status}
                onValueChange={(value) => {
                  if (value && value !== task.status) {
                    putField({ status: value as TaskStatus });
                  }
                  setStatusOpen(false);
                }}
              >
                {TASK_STATUSES.map((s) => (
                  <DropdownMenuRadioItem key={s} value={s}>
                    {t(`tasks.status_${s}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </PropRow>

        <PropRow label={<Label>{t("tasks.priority")}</Label>}>
          <DropdownMenu open={priorityOpen} onOpenChange={setPriorityOpen}>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start px-2"
                  aria-label={t("tasks.priority")}
                />
              }
            >
              {t(`tasks.priority_${task.priority}`)}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={task.priority}
                onValueChange={(value) => {
                  if (value && value !== task.priority) {
                    putField({ priority: value as TaskPriority });
                  }
                  setPriorityOpen(false);
                }}
              >
                {TASK_PRIORITIES.map((p) => (
                  <DropdownMenuRadioItem key={p} value={p}>
                    {t(`tasks.priority_${p}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </PropRow>

        <PropRow
          label={
            <Label className="flex items-center gap-1.5">
              {t("tasks.assignee")}
              {task.assignee?.kind === "agent" ? <AgentBadge /> : null}
            </Label>
          }
        >
          <Select
            aria-label={t("tasks.assignee")}
            items={[
              { value: "", label: t("tasks.unassigned") },
              ...(members ?? []).map((m) => ({
                value: assigneeValue("human", m.user_id),
                label: m.display_name,
              })),
              ...(agents ?? []).map((a) => ({
                value: assigneeValue("agent", a.id),
                label: `${a.name} · ${t("agents.badge")}`,
              })),
            ]}
            value={
              task.assignee_id
                ? assigneeValue(task.assignee_kind, task.assignee_id)
                : ""
            }
            onValueChange={(v) => patchField(parseAssignee(v ?? ""))}
          />
        </PropRow>

        <PropRow label={<Label>{t("tasks.detail.prop_project")}</Label>}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start px-2 py-1.5 text-caption"
            disabled={projectsDisabled}
            aria-disabled={projectsDisabled || undefined}
            title={projectsDisabled ? projectsReason : undefined}
          >
            {task.project_id
              ? task.project_id
              : t("tasks.detail.prop_project_none")}
          </Button>
        </PropRow>

        <PropRow label={<Label>{t("tasks.detail.prop_labels")}</Label>}>
          <div className="space-y-1.5">
            <ul className="flex flex-wrap gap-1">
              {(onTaskLabels.data?.labels ?? []).map((l) => (
                <li key={l.id}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className={cn("h-7 px-2 text-caption hover:opacity-80", tintClass[tintFromColor(l.color)])}
                    onClick={() => detachLabel.mutate(l.id)}
                  >
                    {l.name}
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex gap-1">
              <Select
                aria-label={t("tasks.detail.prop_labels")}
                items={[
                  { value: "", label: t("tasks.detail.add_label") },
                  ...(labelsQuery.data?.labels ?? [])
                    .filter((l) => !attachedIds.has(l.id))
                    .map((l) => ({ value: l.id, label: l.name })),
                ]}
                value={labelId}
                onValueChange={(v) => setLabelId(v ?? "")}
              />
              <Button
                type="button"
                size="sm"
                disabled={!labelId || attachLabel.isPending}
                onClick={() => {
                  if (!labelId) return;
                  attachLabel.mutate(labelId, {
                    onSuccess: () => setLabelId(""),
                    onError: (err) => toastApiError(err, t("common.error")),
                  });
                }}
              >
                {t("tasks.detail.attach_label")}
              </Button>
            </div>
          </div>
        </PropRow>

        <PropRow label={<Label>{t("tasks.detail.prop_start_date")}</Label>}>
          <div title={surfaceNotReady}>
            <DateField
              value={task.start_date ?? ""}
              onChange={() => {}}
              disabled
            />
          </div>
        </PropRow>

        <PropRow label={<Label>{t("tasks.dueDate")}</Label>}>
          <DateField
            value={task.due_date ?? ""}
            onChange={(v) => patchField({ due_date: v || null })}
          />
        </PropRow>

        <PropRow label={<Label>{t("tasks.detail.prop_stage")}</Label>}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start px-2 py-1.5 text-caption"
            disabled
            aria-disabled
            title={surfaceNotReady}
          >
            {t("tasks.detail.prop_stage_none")}
          </Button>
        </PropRow>

        <PropRow label={<Label>{t("tasks.detail.prop_custom")}</Label>}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start px-2 py-1.5 text-caption text-muted-foreground"
            data-testid="task-detail-custom-properties"
            disabled={catalogEmpty}
            aria-disabled={catalogEmpty || undefined}
            title={catalogEmpty ? surfaceNotReady : undefined}
          >
            {catalogEmpty
              ? t("tasks.table.columns.properties_stub")
              : t("tasks.detail.custom_properties_count", {
                  count: catalog.length,
                })}
          </Button>
        </PropRow>
      </div>
    </aside>
  );
}
