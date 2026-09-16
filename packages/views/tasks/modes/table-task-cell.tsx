"use client";

import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Table as TanstackTable } from "@tanstack/react-table";
import {
  propertyIdFromViewKey,
  type TableColumnKey,
} from "@uniwork/core/tasks/stores/view-store";
import type { Task, TaskProperty } from "@uniwork/core/types";
import { PropertyValueEditor } from "../properties/property-value-editor";
import { formatPropertyValue } from "../properties/property-value";
import { usePickerTriggerLabel } from "../pickers/trigger-label";
import { InlineTitle } from "./table-inline-title";
import {
  TableAssigneeCell,
  TableDateCell,
  TableDateText,
  TableLabelsCell,
  TablePriorityCell,
  TableProgressCell,
  TableProjectCell,
  TableStatusCell,
} from "./table-cell-editors";
import type { TaskTableDisplayRow } from "./table-view-model";
import { getTableViewMeta, type TableViewMeta } from "./table-view-meta";

/** A property column whose definition is gone from the catalog. */
const MISSING_VALUE = "—";

function stopRowNavigation(event: SyntheticEvent) {
  event.stopPropagation();
}

/** A custom property's value, edited in place; archived ones only clear. */
function TablePropertyCell({
  task,
  property,
  meta,
}: {
  task: Task;
  property: TaskProperty;
  meta: TableViewMeta;
}) {
  const { t, i18n } = useTranslation();
  const value = task.properties?.[property.id];
  const shown = formatPropertyValue(property, value, i18n.language);
  // A checkbox shows no text, so its name is the field alone.
  const ariaLabel = usePickerTriggerLabel(
    property.name,
    property.type === "checkbox" ? undefined : shown || t("tasks.properties.empty"),
  );
  const disabled = meta.editingDisabled || meta.propertiesDisabled;
  return (
    <PropertyValueEditor
      property={property}
      value={value}
      disabled={disabled}
      disabledReason={
        meta.editingDisabled
          ? meta.editingDisabledReason
          : meta.propertiesDisabledReason
      }
      onChange={(next) => meta.setPropertyValue(task.id, property.id, next)}
      onClear={() => meta.clearPropertyValue(task.id, property.id)}
      ariaLabel={ariaLabel}
      triggerClassName="h-7 max-w-full justify-start gap-1.5 px-1.5 font-normal"
      onTriggerNavigationGuard={stopRowNavigation}
    />
  );
}

export function TaskCellContent({
  columnKey,
  row,
  table,
}: {
  columnKey: TableColumnKey;
  row: Extract<TaskTableDisplayRow, { kind: "task" }>;
  table: TanstackTable<TaskTableDisplayRow>;
}): ReactNode {
  const { t } = useTranslation();
  const meta = getTableViewMeta(table);
  const task = row.task;

  const propertyId = propertyIdFromViewKey(columnKey);
  if (propertyId) {
    const property = meta.properties.get(propertyId);
    if (!property) {
      return <span className="text-caption text-muted-foreground">{MISSING_VALUE}</span>;
    }
    return <TablePropertyCell task={task} property={property} meta={meta} />;
  }

  switch (columnKey) {
    case "title":
      return (
        <InlineTitle
          identifier={task.identifier}
          title={task.title}
          depth={row.depth}
          hasChildren={row.hasChildren}
          collapsed={row.collapsed}
          hierarchyDisabled={meta.hierarchyDisabled}
          editingDisabled={meta.editingDisabled}
          editingDisabledReason={meta.editingDisabledReason}
          onToggleChildren={() => meta.toggleTableParentExpanded(task.id)}
          onCommit={(title) => meta.updateTask(task.id, { title })}
        />
      );
    case "identifier":
      return (
        <span className="text-caption text-muted-foreground">
          {task.identifier || "—"}
        </span>
      );
    case "status":
      return (
        <TableStatusCell
          value={task.status}
          onChange={(status) => meta.updateTask(task.id, { status })}
        />
      );
    case "priority":
      return (
        <TablePriorityCell
          value={task.priority}
          onChange={(priority) => meta.updateTask(task.id, { priority })}
        />
      );
    case "assignee":
      return (
        <TableAssigneeCell
          assigneeId={task.assignee_id}
          assigneeName={task.assignee?.display_name}
          assigneeKind={task.assignee?.kind ?? task.assignee_kind}
          options={meta.assigneeOptions}
          onChange={(next) =>
            meta.updateTask(task.id, {
              assignee_id: next?.id ?? null,
              assignee_kind: next?.kind ?? "human",
            })
          }
        />
      );
    case "due_date":
      return (
        <TableDateCell
          value={task.due_date}
          onChange={(dueDate) => meta.updateTask(task.id, { due_date: dueDate })}
        />
      );
    case "start_date":
      return (
        <TableDateCell
          value={task.start_date}
          onChange={(startDate) =>
            meta.updateTask(task.id, { start_date: startDate })
          }
        />
      );
    case "created_at":
    case "updated_at":
      return <TableDateText value={task[columnKey]} />;
    case "creator": {
      const creator = meta.members.find(
        (member) => member.id === task.created_by,
      );
      return (
        <span className="text-caption text-muted-foreground">
          {creator?.name ?? task.created_by}
        </span>
      );
    }
    case "project":
      return (
        <TableProjectCell
          projectId={task.project_id ?? undefined}
          projects={meta.projects}
          onChange={(projectId) =>
            meta.updateTask(task.id, { project_id: projectId })
          }
        />
      );
    case "child_progress": {
      const progress = meta.childProgress.get(task.id);
      return (
        <TableProgressCell done={progress?.done} total={progress?.total} />
      );
    }
    case "labels":
      return (
        <TableLabelsCell
          workspaceId={meta.workspaceId}
          taskId={task.id}
          labels={meta.labels}
        />
      );
    default:
      return (
        <span className="text-caption text-muted-foreground">
          {t("tasks.table.unavailable_cell")}
        </span>
      );
  }
}
