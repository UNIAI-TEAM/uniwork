"use client";

import type { ReactNode } from "react";
import type { TaskProperty } from "@uniwork/core/types";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { DateField } from "../common/date-field";
import { ClearablePillButton, PillButton } from "../common/pill-button";
import { CreateTaskCustomProperties } from "./create-task-custom-properties";
import { PropertyIcon } from "./icons/property-icon";

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
  startDateLabel: string;
  dueDateLabel: string;
  revealed: ReadonlySet<OverflowFieldKey>;
  onReveal: (key: OverflowFieldKey) => void;
  onClear: (key: OverflowFieldKey) => void;
  parentItems: SelectItem[];
  parentValue: string | undefined;
  onParentChange: (value: string | undefined) => void;
  stageValue: string | undefined;
  onStageChange: (value: string | undefined) => void;
  startDate: string | undefined;
  onStartDateChange: (value: string | undefined) => void;
  dueDate: string | undefined;
  onDueDateChange: (value: string | undefined) => void;
  properties: TaskProperty[];
  propertyValues: Record<string, unknown>;
  onPropertyChange: (propertyId: string, value: unknown | undefined) => void;
};

function RevealedPill({
  clearLabel,
  onClear,
  children,
}: {
  clearLabel: string;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <ClearablePillButton onClear={onClear} clearLabel={clearLabel}>
      {children}
    </ClearablePillButton>
  );
}

export function CreateTaskManualOverflow({
  moreFieldsLabel,
  clearLabel,
  parentLabel,
  stageLabel,
  startDateLabel,
  dueDateLabel,
  revealed,
  onReveal,
  onClear,
  parentItems,
  parentValue,
  onParentChange,
  stageValue,
  onStageChange,
  startDate,
  onStartDateChange,
  dueDate,
  onDueDateChange,
  properties,
  propertyValues,
  onPropertyChange,
}: CreateTaskManualOverflowProps) {
  const hiddenProperties = properties.filter((property) => !revealed.has(propertyFieldKey(property.id)));
  const menuItems: { key: OverflowFieldKey; label: string; icon?: ReactNode }[] = [
    ...(!revealed.has("parent") ? [{ key: "parent" as const, label: parentLabel }] : []),
    ...(!revealed.has("stage") ? [{ key: "stage" as const, label: stageLabel }] : []),
    ...(!revealed.has("start_date") ? [{ key: "start_date" as const, label: startDateLabel }] : []),
    ...(!revealed.has("due_date") ? [{ key: "due_date" as const, label: dueDateLabel }] : []),
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
        <RevealedPill
          clearLabel={clearLabel}
          onClear={() => {
            onParentChange(undefined);
            onClear("parent");
          }}
        >
          <Select
            id="task-parent"
            aria-label={parentLabel}
            items={parentItems}
            value={parentValue || "__none__"}
            onValueChange={(value) =>
              onParentChange(!value || value === "__none__" ? undefined : value)
            }
            triggerVariant="subtle"
          />
        </RevealedPill>
      ) : null}
      {revealed.has("stage") ? (
        <RevealedPill
          clearLabel={clearLabel}
          onClear={() => {
            onStageChange(undefined);
            onClear("stage");
          }}
        >
          <div className="flex items-center gap-1.5">
            <Label htmlFor="task-stage" className="sr-only">
              {stageLabel}
            </Label>
            <Input
              id="task-stage"
              type="number"
              min={1}
              className="h-8 w-20 rounded-full border-border/80 bg-transparent px-2.5 text-caption"
              value={stageValue ?? ""}
              onChange={(event) => onStageChange(event.target.value || undefined)}
              placeholder={stageLabel}
            />
          </div>
        </RevealedPill>
      ) : null}
      {revealed.has("start_date") ? (
        <RevealedPill
          clearLabel={clearLabel}
          onClear={() => {
            onStartDateChange(undefined);
            onClear("start_date");
          }}
        >
          <div className="min-w-36">
            <Label htmlFor="task-start-date" className="sr-only">
              {startDateLabel}
            </Label>
            <DateField
              id="task-start-date"
              value={startDate ?? ""}
              onChange={(value) => onStartDateChange(value || undefined)}
              modal={false}
              className="h-8 rounded-full border-border/80 bg-muted/40"
            />
          </div>
        </RevealedPill>
      ) : null}
      {revealed.has("due_date") ? (
        <RevealedPill
          clearLabel={clearLabel}
          onClear={() => {
            onDueDateChange(undefined);
            onClear("due_date");
          }}
        >
          <div className="min-w-36">
            <Label htmlFor="task-due-date" className="sr-only">
              {dueDateLabel}
            </Label>
            <DateField
              id="task-due-date"
              value={dueDate ?? ""}
              onChange={(value) => onDueDateChange(value || undefined)}
              modal={false}
              className="h-8 rounded-full border-border/80 bg-muted/40"
            />
          </div>
        </RevealedPill>
      ) : null}
      {revealedProperties.length > 0 ? (
        <div className="flex w-full flex-wrap items-end gap-2">
          <CreateTaskCustomProperties
            properties={revealedProperties}
            values={propertyValues}
            onChange={onPropertyChange}
          />
        </div>
      ) : null}
      {menuItems.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<PillButton aria-label={moreFieldsLabel} />}
          >
            <MoreHorizontal className="size-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {menuItems.map((item) => (
              <DropdownMenuItem key={item.key} onClick={() => onReveal(item.key)}>
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
