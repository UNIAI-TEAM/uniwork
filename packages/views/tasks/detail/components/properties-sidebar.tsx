"use client";

import { useMemo, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { paths } from "@uniwork/core/paths";
import {
  useLabelsOnTask,
  usePutTask,
  useTask,
  useTaskLabels,
  useTaskProperties,
  useUpdateTask,
} from "@uniwork/core/tasks";
import { type Task } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Label } from "@uniwork/ui/components/ui/label";
import { AgentBadge } from "../../../agents/agent-badge";
import { DateField } from "../../../common/date-field";
import { PAGE_GUTTER } from "../../../layout/page-header";
import { useWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";
import { toastApiError } from "../../../toast-api-error";
import { cn } from "@uniwork/ui/lib/utils";
import {
  AssigneePicker,
  LabelPicker,
  PriorityPicker,
  StatusPicker,
  labelChipClass,
  useTaskLabelToggle,
  type AssigneeOption,
  type AssigneeRef,
} from "../../pickers";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

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
  const labelToggle = useTaskLabelToggle(workspaceId, task.id);
  const parentId = task.parent_task_id ?? null;
  const { data: parentTask } = useTask(parentId ?? "");

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

  const attachedLabels = useMemo(
    () => onTaskLabels.data?.labels ?? [],
    [onTaskLabels.data?.labels],
  );
  const attachedIds = useMemo(
    () => new Set(attachedLabels.map((l) => l.id)),
    [attachedLabels],
  );

  // Only the sidebar offers agents as assignees today (ADR 0007 pair: id +
  // kind travel together). The table cell and batch toolbar deliberately
  // keep offering human members only — see the task-2 report.
  const assigneeOptions: AssigneeOption[] = useMemo(
    () => [
      ...(members ?? []).map((m) => ({
        id: m.user_id,
        kind: "human" as const,
        name: m.display_name || m.email,
        secondaryLabel: m.email,
        ...(typeof m.avatar_url === "string" ? { avatarUrl: m.avatar_url } : {}),
      })),
      ...(agents ?? []).map((a) => ({
        id: a.id,
        kind: "agent" as const,
        name: a.name,
        ...(a.avatar_url ? { avatarUrl: a.avatar_url } : {}),
      })),
    ],
    [members, agents],
  );
  const assigneeValue: AssigneeRef | null = task.assignee_id
    ? { id: task.assignee_id, kind: task.assignee_kind === "agent" ? "agent" : "human" }
    : null;

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
          <StatusPicker
            value={task.status}
            ariaLabel={t("tasks.status")}
            valueLabel={t(`tasks.status_${task.status}`)}
            triggerClassName="h-8 w-full justify-start px-2"
            onChange={(value) => {
              // Skip the PUT when the picked value matches the current one:
              // this call is revisioned, so a no-op selection would still
              // spend a revision bump for nothing.
              if (value !== task.status) {
                putField({ status: value });
              }
            }}
          >
            {t(`tasks.status_${task.status}`)}
          </StatusPicker>
        </PropRow>

        <PropRow label={<Label>{t("tasks.priority")}</Label>}>
          <PriorityPicker
            value={task.priority}
            ariaLabel={t("tasks.priority")}
            valueLabel={t(`tasks.priority_${task.priority}`)}
            triggerClassName="h-8 w-full justify-start px-2"
            onChange={(value) => {
              if (value !== task.priority) {
                putField({ priority: value });
              }
            }}
          >
            {t(`tasks.priority_${task.priority}`)}
          </PriorityPicker>
        </PropRow>

        <PropRow
          label={
            <Label className="flex items-center gap-1.5">
              {t("tasks.assignee")}
              {task.assignee?.kind === "agent" ? <AgentBadge /> : null}
            </Label>
          }
        >
          <AssigneePicker
            value={assigneeValue}
            options={assigneeOptions}
            ariaLabel={t("tasks.assignee")}
            valueLabel={task.assignee?.display_name ?? t("tasks.unassigned")}
            unassignedLabel={t("tasks.unassigned")}
            searchPlaceholder={t("tasks.assignee_search_placeholder")}
            noResultsLabel={t("tasks.assignee_no_results")}
            triggerClassName="h-8 w-full justify-start px-2"
            onChange={(next) => {
              if (!next) {
                // Id and kind travel together (ADR 0007), as the table and
                // row menu send them.
                patchField({ assignee_id: null, assignee_kind: "human" });
              } else {
                patchField({ assignee_id: next.id, assignee_kind: next.kind });
              }
            }}
          >
            {task.assignee ? (
              <span className="truncate">{task.assignee.display_name}</span>
            ) : (
              <span className="truncate text-muted-foreground">
                {t("tasks.unassigned")}
              </span>
            )}
          </AssigneePicker>
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
            {attachedLabels.length > 0 ? (
              <ul className="flex flex-wrap gap-1">
                {attachedLabels.map((l) => (
                  <li
                    key={l.id}
                    className={cn(
                      "inline-flex h-7 items-center gap-0.5 rounded-md pr-0.5 pl-2 text-caption",
                      labelChipClass(l.color),
                    )}
                  >
                    <span className="max-w-32 truncate">{l.name}</span>
                    {/* Removal is an explicit × with its own name, not a click
                        on the chip: a screen reader announced the old chip as
                        just "Bug, button" with nothing saying it would detach. */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-current hover:bg-foreground/10"
                      aria-label={t("tasks.detail.remove_label", { name: l.name })}
                      aria-disabled={labelToggle.pendingIds.has(l.id) || undefined}
                      onClick={() => labelToggle.toggle(l.id, false)}
                    >
                      <X aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <LabelPicker
              labels={labelsQuery.data?.labels ?? []}
              selectedIds={attachedIds}
              pendingIds={labelToggle.pendingIds}
              onToggle={labelToggle.toggle}
              ariaLabel={t("tasks.detail.add_label")}
              emptyLabel={t("tasks.table.labels_empty")}
              triggerClassName="h-8 w-full justify-start px-2 text-muted-foreground"
            >
              {t("tasks.detail.add_label")}
            </LabelPicker>
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
