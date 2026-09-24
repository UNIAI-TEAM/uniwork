"use client";

import { useState, type ReactNode } from "react";
import type { TaskProperty } from "@uniwork/core/types";
import { ArrowUp, CalendarClock, CalendarDays, Milestone, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { PillButton } from "../common/pill-button";
import { CreateTaskCustomProperties } from "./create-task-custom-properties";
import { PropertyIcon } from "./icons/property-icon";
import { CreateTaskStageField } from "./pickers/create-task-overflow-fields";
import { CreateTaskParentField } from "./pickers/create-task-project-fields";
import { TaskScheduleField, type TaskScheduleValue } from "./task-schedule-field";

export type OverflowFieldKey =
  | "parent"
  | "stage"
  | "start_date"
  | "due_date"
  | `prop:${string}`;

export function propertyFieldKey(propertyId: string): OverflowFieldKey {
  return `prop:${propertyId}`;
}

type SelectItem = { value: string; label: string };

type CreateTaskManualOverflowProps = {
  moreFieldsLabel: string;
  clearLabel: string;
  parentLabel: string;
  stageLabel: string;
  stageNoneLabel: string;
  startDateLabel: string;
  dueDateLabel: string;
  parentSearchPlaceholder: string;
  optionsNoResultsLabel: string;
  parentNoneLabel: string;
  revealed: ReadonlySet<OverflowFieldKey>;
  onReveal: (key: OverflowFieldKey) => void;
  onClear: (key: OverflowFieldKey) => void;
  parentItems: SelectItem[];
  parentValue: string | undefined;
  onParentChange: (value: string | undefined) => void;
  stageValue: string | undefined;
  maxSiblingStage: number;
  onStageChange: (value: string | undefined) => void;
  startDate: string | undefined;
  dueDate: string | undefined;
  startAt: string | undefined;
  dueAt: string | undefined;
  onScheduleChange: (value: TaskScheduleValue) => void;
  properties: TaskProperty[];
  propertyValues: Record<string, unknown>;
  onPropertyChange: (propertyId: string, value: unknown | undefined) => void;
};

export function CreateTaskManualOverflow({
  moreFieldsLabel,
  clearLabel,
  parentLabel,
  stageLabel,
  stageNoneLabel,
  startDateLabel,
  dueDateLabel,
  parentSearchPlaceholder,
  optionsNoResultsLabel,
  parentNoneLabel,
  revealed,
  onReveal,
  onClear,
  parentItems,
  parentValue,
  onParentChange,
  stageValue,
  maxSiblingStage,
  onStageChange,
  startDate,
  dueDate,
  startAt,
  dueAt,
  onScheduleChange,
  properties,
  propertyValues,
  onPropertyChange,
}: CreateTaskManualOverflowProps) {
  const [activePicker, setActivePicker] = useState<OverflowFieldKey | null>(null);
  const hiddenProperties = properties.filter((property) => !revealed.has(propertyFieldKey(property.id)));
  const menuItems: { key: OverflowFieldKey; label: string; icon?: ReactNode }[] = [
    ...(!revealed.has("parent")
      ? [{ key: "parent" as const, label: parentLabel, icon: <ArrowUp className="size-3.5" aria-hidden /> }]
      : []),
    ...(!revealed.has("stage")
      ? [{ key: "stage" as const, label: stageLabel, icon: <Milestone className="size-3.5" aria-hidden /> }]
      : []),
    ...(!revealed.has("start_date")
      ? [{ key: "start_date" as const, label: startDateLabel, icon: <CalendarClock className="size-3.5" aria-hidden /> }]
      : []),
    ...(!revealed.has("due_date")
      ? [{ key: "due_date" as const, label: dueDateLabel, icon: <CalendarDays className="size-3.5" aria-hidden /> }]
      : []),
    ...hiddenProperties.map((property) => ({
      key: propertyFieldKey(property.id),
      label: property.name,
      icon: <PropertyIcon property={property} className="size-3.5 text-muted-foreground" />,
    })),
  ];

  const revealedProperties = properties.filter((property) => revealed.has(propertyFieldKey(property.id)));

  return (
    <>
      {revealed.has("parent") ? (
        <CreateTaskParentField
          items={parentItems}
          value={parentValue}
          ariaLabel={parentLabel}
          noneLabel={parentNoneLabel}
          searchPlaceholder={parentSearchPlaceholder}
          noResultsLabel={optionsNoResultsLabel}
          clearLabel={clearLabel}
          onChange={onParentChange}
          onClear={() => onClear("parent")}
          open={activePicker === "parent"}
          onOpenChange={(open) => setActivePicker(open ? "parent" : null)}
        />
      ) : null}
      {revealed.has("stage") ? (
        <CreateTaskStageField
          value={stageValue}
          label={stageLabel}
          noneLabel={stageNoneLabel}
          maxSiblingStage={maxSiblingStage}
          open={activePicker === "stage"}
          onOpenChange={(open) => setActivePicker(open ? "stage" : null)}
          onChange={onStageChange}
        />
      ) : null}
      {revealed.has("start_date") ? (
        <TaskScheduleField
          value={{ start_date: startDate, due_date: dueDate, start_at: startAt, due_at: dueAt }}
          label={startDateLabel}
          kind="start"
          compact
          open={activePicker === "start_date"}
          onOpenChange={(open) => setActivePicker(open ? "start_date" : null)}
          onChange={onScheduleChange}
        />
      ) : null}
      {revealed.has("due_date") ? (
        <TaskScheduleField
          value={{ start_date: startDate, due_date: dueDate, start_at: startAt, due_at: dueAt }}
          label={dueDateLabel}
          kind="due"
          compact
          open={activePicker === "due_date"}
          onOpenChange={(open) => setActivePicker(open ? "due_date" : null)}
          onChange={onScheduleChange}
        />
      ) : null}
      {revealedProperties.length > 0 ? (
        <CreateTaskCustomProperties
          properties={revealedProperties}
          values={propertyValues}
          activePropertyId={activePicker?.startsWith("prop:") ? activePicker.slice(5) : undefined}
          onActivePropertyChange={(propertyId) =>
            setActivePicker(propertyId ? propertyFieldKey(propertyId) : null)
          }
          onChange={onPropertyChange}
        />
      ) : null}
      {menuItems.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<PillButton aria-label={moreFieldsLabel} />}>
            <MoreHorizontal className="size-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {menuItems.map((item) => (
              <DropdownMenuItem
                key={item.key}
                onClick={() => {
                  onReveal(item.key);
                  // Let the dropdown finish dismissing before mounting the popover;
                  // otherwise its outside-click can immediately close the new picker.
                  setTimeout(() => setActivePicker(item.key), 0);
                }}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}
