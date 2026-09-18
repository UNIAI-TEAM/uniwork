"use client";

import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  TaskDateField,
  TaskDateFilter,
} from "@uniwork/core/tasks/stores/view-store-types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@uniwork/ui/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";
import { dateOnlyToLocalDate, toDateOnly } from "../../common/date-field";

const Calendar = lazy(() =>
  import("@uniwork/ui/components/ui/calendar").then((m) => ({
    default: m.Calendar,
  })),
);

type LocalDateRange = {
  from: Date | undefined;
  to?: Date;
};

function normalizeDateRange(from: Date, to: Date) {
  return from <= to ? ([from, to] as const) : ([to, from] as const);
}

function addDaysDateOnly(delta: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + delta);
  return toDateOnly(d);
}

function todayDateOnly(): string {
  return toDateOnly(new Date());
}

export function FilterDatePanel({
  value,
  onChange,
}: {
  value: TaskDateFilter | null;
  onChange: (filter: TaskDateFilter | null) => void;
}) {
  const { t } = useTranslation();
  const [field, setField] = useState<TaskDateField>(
    value?.field ?? "created_at",
  );
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [range, setRange] = useState<LocalDateRange | undefined>(() => {
    if (!value) return undefined;
    const from = dateOnlyToLocalDate(value.from);
    if (!from) return undefined;
    return { from, to: dateOnlyToLocalDate(value.to) };
  });

  const setFieldValue = (next: TaskDateField) => {
    setField(next);
    if (value) onChange({ ...value, field: next });
  };

  const applyPreset = (days: 1 | 3 | 7) => {
    onChange({
      field,
      from: addDaysDateOnly(1 - days),
      to: todayDateOnly(),
    });
  };

  const applyCustom = () => {
    if (!range?.from) return;
    const [from, to] = normalizeDateRange(range.from, range.to ?? range.from);
    onChange({
      field,
      from: toDateOnly(from),
      to: toDateOnly(to),
    });
    setCalendarOpen(false);
  };

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t("tasks.filters.date_field")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={field}
          onValueChange={(next) => setFieldValue(next as TaskDateField)}
        >
          <DropdownMenuRadioItem value="created_at" closeOnClick={false}>
            {t("tasks.filters.date_field_created")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="updated_at" closeOnClick={false}>
            {t("tasks.filters.date_field_updated")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />
      <DropdownMenuItem closeOnClick={false} onClick={() => applyPreset(1)}>
        {t("tasks.filters.date_today")}
      </DropdownMenuItem>
      <DropdownMenuItem closeOnClick={false} onClick={() => applyPreset(3)}>
        {t("tasks.filters.date_last_3_days")}
      </DropdownMenuItem>
      <DropdownMenuItem closeOnClick={false} onClick={() => applyPreset(7)}>
        {t("tasks.filters.date_last_7_days")}
      </DropdownMenuItem>

      <div className="px-1.5 py-1">
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-start px-0 text-body font-normal"
              />
            }
          >
            {t("tasks.filters.date_custom_range")}
          </PopoverTrigger>
          <PopoverContent align="start" side="right" className="w-auto gap-0 p-0">
            <Suspense fallback={null}>
              <Calendar
                mode="range"
                selected={range}
                onSelect={(next) => setRange(next)}
                captionLayout="dropdown"
              />
            </Suspense>
            <div className="flex justify-end border-t p-2">
              <Button
                type="button"
                size="sm"
                onClick={applyCustom}
                disabled={!range?.from}
              >
                {t("tasks.filters.date_apply")}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {value ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            closeOnClick={false}
            onClick={() => {
              setRange(undefined);
              onChange(null);
            }}
          >
            {t("tasks.filters.date_clear")}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}
