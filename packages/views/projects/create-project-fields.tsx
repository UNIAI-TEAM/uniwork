"use client";

import { Suspense, lazy, useState } from "react";
import { CalendarClock, CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PROJECT_STATUS_CONFIG,
  PROJECT_STATUS_ORDER,
} from "@uniwork/core/projects/config";
import type { ProjectStatus } from "@uniwork/core/types/project";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../common/date-field";
import { PillButton } from "../common/pill-button";
import { PickerItem, PropertyPicker } from "../tasks/pickers/property-picker";

// emoji-mart ships its whole dataset; load it when the picker opens, not with the list page.
const EmojiPicker = lazy(() =>
  import("@uniwork/ui/components/common/emoji-picker").then((m) => ({
    default: m.EmojiPicker,
  })),
);

export const DEFAULT_PROJECT_ICON = "📁";

export function ProjectIconField({
  value,
  onChange,
  className,
}: {
  value: string | undefined;
  onChange: (icon: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={t("projects.create_dialog.icon_label")}
            title={t("projects.create_dialog.icon_label")}
            className={cn(
              "-ml-1 cursor-pointer rounded-lg p-1 text-title leading-none transition-colors hover:bg-accent/60",
              className,
            )}
          />
        }
      >
        {value || DEFAULT_PROJECT_ICON}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Suspense fallback={<div className="h-80 w-72" aria-hidden />}>
          <EmojiPicker
            onSelect={(emoji) => {
              onChange(emoji);
              setOpen(false);
            }}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}

export function CreateProjectStatusField({
  value,
  onChange,
}: {
  value: ProjectStatus;
  onChange: (status: ProjectStatus) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <PropertyPicker
      open={open}
      onOpenChange={setOpen}
      width="w-48"
      align="start"
      triggerRender={<PillButton aria-label={t("projects.table.status")} />}
      trigger={
        <>
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", PROJECT_STATUS_CONFIG[value].dotColor)}
          />
          <span className="truncate">{t(`projects.status.${value}`)}</span>
        </>
      }
    >
      {PROJECT_STATUS_ORDER.map((status) => (
        <PickerItem
          key={status}
          selected={status === value}
          onClick={() => {
            onChange(status);
            setOpen(false);
          }}
        >
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", PROJECT_STATUS_CONFIG[status].dotColor)}
          />
          <span className="truncate">{t(`projects.status.${status}`)}</span>
        </PickerItem>
      ))}
    </PropertyPicker>
  );
}

/** Start / due date pills; each bounds the other so the range stays ordered. */
export function CreateProjectDateFields({
  startDate,
  dueDate,
  onStartDateChange,
  onDueDateChange,
}: {
  startDate: string;
  dueDate: string;
  onStartDateChange: (value: string) => void;
  onDueDateChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const startLabel = t("projects.detail.prop_start_date");
  const dueLabel = t("projects.detail.prop_due_date");
  return (
    <>
      <DateField
        value={startDate}
        onChange={onStartDateChange}
        max={dueDate || undefined}
        modal={false}
        placeholder={startLabel}
        ariaLabel={startLabel}
        triggerRender={<PillButton />}
        renderTrigger={(label) => (
          <>
            <CalendarClock aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{label}</span>
          </>
        )}
      />
      <DateField
        value={dueDate}
        onChange={onDueDateChange}
        min={startDate || undefined}
        modal={false}
        placeholder={dueLabel}
        ariaLabel={dueLabel}
        triggerRender={<PillButton />}
        renderTrigger={(label) => (
          <>
            <CalendarDays aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{label}</span>
          </>
        )}
      />
    </>
  );
}
