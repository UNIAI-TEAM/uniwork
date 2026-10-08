"use client";

import { useMemo, useState } from "react";
import { CalendarClock, CalendarDays, SlidersHorizontal, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import {
  useLabelsOnTask,
  usePutTask,
  useSetTaskPropertyValue,
  useTaskLabels,
  useTaskProperties,
  useUnsetTaskPropertyValue,
  useUpdateTask,
} from "@uniwork/core/tasks";
import { type Task } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { DatePill } from "../../../common/date-pill";
import { PropRow } from "../../../common/prop-row";
import { SidebarSection } from "../../../common/sidebar-section";
import { RelatedSection } from "../../../graph/related-section";
import { PAGE_GUTTER } from "../../../layout/page-header";
import { toastApiError } from "../../../toast-api-error";
import { PriorityIcon } from "../../icons/priority-icon";
import { useStatusCatalog } from "../../pickers";
import { TaskPriorityRow, TaskStatusRow } from "./properties-sidebar-enum-fields";
import { TaskAddPropertyMenu, type AddablePropertyOption } from "./task-add-property-menu";
import { TaskAssigneeRow } from "./task-assignee-row";
import { TaskCustomPropertyRow } from "./task-custom-property-row";
import { TaskDetailMetadata } from "./task-detail-metadata";
import { TaskLabelsRow } from "./task-labels-row";
import { TaskParentSection } from "./task-parent-section";
import { TaskProjectRow } from "./task-project-row";

const ICON_CLASS = "size-3.5 shrink-0 text-muted-foreground";
const CUSTOM_PREFIX = "property:";
const CLOSED_CATEGORIES = new Set(["done", "cancelled"]);

/**
 * Suite properties sidebar. Status, assignee and project always show; the
 * other fields show once set, or once the user adds them from the menu.
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
  const { data: members } = useMembers(workspaceId);
  const { data: agents } = useWorkspaceAgents(workspaceId);
  const put = usePutTask(workspaceId);
  const update = useUpdateTask(workspaceId);
  const setProperty = useSetTaskPropertyValue(workspaceId);
  const unsetProperty = useUnsetTaskPropertyValue(workspaceId);
  const catalog = useTaskProperties(workspaceId).data?.properties ?? [];
  const labelCatalog = useTaskLabels(workspaceId).data?.labels ?? [];
  const onTaskLabels = useLabelsOnTask(task.id);
  const attachedLabels = useMemo(() => onTaskLabels.data?.labels ?? [], [onTaskLabels.data]);
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { optionOf } = useStatusCatalog(workspaceId);

  const onError = (err: unknown) => toastApiError(err, t("common.error"));
  const putField = (patch: { status?: string; priority?: string }) => {
    put.mutate(
      { taskId: task.id, body: { ...patch, revision: task.revision }, ifMatch: String(task.revision) },
      {
        onSuccess: (data) => {
          if (data == null) onRefetch();
        },
        onError: (err) => {
          onError(err);
          onRefetch();
        },
      },
    );
  };
  const patchField = (patch: Parameters<typeof update.mutate>[0]["patch"]) => {
    update.mutate({ taskId: task.id, patch }, { onError });
  };
  const openProps = (key: string) => ({
    open: openKey === key,
    onOpenChange: (open: boolean) => setOpenKey(open ? key : null),
  });

  const isSet: Record<string, boolean> = {
    priority: task.priority !== "none",
    start_date: !!task.start_date,
    due_date: !!task.due_date,
    labels: attachedLabels.length > 0,
  };
  const shows = (key: string) => isSet[key] || added.has(key);
  const customShown = catalog.filter(
    (property) =>
      task.properties?.[property.id] !== undefined || added.has(CUSTOM_PREFIX + property.id),
  );

  const builtIn: AddablePropertyOption[] = [
    { key: "priority", label: t("tasks.priority"), icon: <PriorityIcon priority="none" /> },
    { key: "start_date", label: t("tasks.detail.prop_start_date"), icon: <CalendarClock aria-hidden className={ICON_CLASS} /> },
    { key: "due_date", label: t("tasks.dueDate"), icon: <CalendarDays aria-hidden className={ICON_CLASS} /> },
    { key: "labels", label: t("tasks.detail.prop_labels"), icon: <Tag aria-hidden className={ICON_CLASS} /> },
  ];
  const addable: AddablePropertyOption[] = [
    ...builtIn.filter((option) => !shows(option.key)),
    ...catalog
      .filter((property) => !property.archived_at && !customShown.includes(property))
      .map((property) => ({
        key: CUSTOM_PREFIX + property.id,
        label: property.name,
        icon: <SlidersHorizontal aria-hidden className={ICON_CLASS} />,
      })),
  ];
  const addField = (key: string) => {
    setAdded((prev) => new Set(prev).add(key));
    setOpenKey(key);
  };

  return (
    <aside
      aria-label={t("tasks.detail.properties_sidebar")}
      className={`h-full space-y-5 overflow-y-auto py-4 ${PAGE_GUTTER}`}
    >
      <SidebarSection title={t("tasks.detail.section_properties")}>
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pl-2">
          <TaskStatusRow task={task} onChange={(status) => putField({ status })} />
          <TaskAssigneeRow workspaceId={workspaceId} task={task} onChange={patchField} />
          <TaskProjectRow
            workspaceId={workspaceId}
            task={task}
            onChange={(project_id) => patchField({ project_id })}
          />
          {shows("priority") ? (
            <TaskPriorityRow
              task={task}
              {...openProps("priority")}
              onChange={(priority) => putField({ priority })}
            />
          ) : null}
          {shows("start_date") ? (
            <PropRow label={t("tasks.detail.prop_start_date")}>
              <DatePill
                value={task.start_date ?? null}
                label={t("tasks.detail.prop_start_date")}
                icon={<CalendarClock aria-hidden className={ICON_CLASS} />}
                max={task.due_date ?? undefined}
                {...openProps("start_date")}
                onChange={(start_date) => patchField({ start_date })}
              />
            </PropRow>
          ) : null}
          {shows("due_date") ? (
            <PropRow label={t("tasks.dueDate")}>
              <DatePill
                value={task.due_date ?? null}
                label={t("tasks.dueDate")}
                icon={<CalendarDays aria-hidden className={ICON_CLASS} />}
                min={task.start_date ?? undefined}
                highlightOverdue={!CLOSED_CATEGORIES.has(optionOf(task.status).category)}
                {...openProps("due_date")}
                onChange={(due_date) => patchField({ due_date })}
              />
            </PropRow>
          ) : null}
          {shows("labels") ? (
            <TaskLabelsRow
              workspaceId={workspaceId}
              taskId={task.id}
              catalog={labelCatalog}
              attached={attachedLabels}
              defaultOpen={openKey === "labels"}
            />
          ) : null}
          {customShown.map((property) => (
            <TaskCustomPropertyRow
              key={property.id}
              task={task}
              property={property}
              onChange={(value) =>
                setProperty.mutate({ taskId: task.id, propertyId: property.id, value }, { onError })
              }
              onClear={() =>
                unsetProperty.mutate({ taskId: task.id, propertyId: property.id }, { onError })
              }
            />
          ))}
        </div>
        <TaskAddPropertyMenu options={addable} onAdd={addField} />
      </SidebarSection>

      <TaskParentSection workspaceId={workspaceId} task={task} />

      <RelatedSection workspaceId={workspaceId} nodeType="TASK" nodeId={task.id} />

      <TaskDetailMetadata
        creatorId={task.created_by}
        creatorKind={task.created_by_kind}
        members={members}
        agents={agents}
        createdAt={task.created_at}
        updatedAt={task.updated_at}
      />
    </aside>
  );
}
