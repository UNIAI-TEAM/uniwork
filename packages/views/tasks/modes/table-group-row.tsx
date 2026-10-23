"use client";

import type { ComponentProps } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import {
  TableCell,
  TableRow,
} from "@uniwork/ui/components/ui/table";
import { tintFromColor } from "@uniwork/ui/lib/tint-from-color";
import { cn } from "@uniwork/ui/lib/utils";
import type { TaskTableDisplayRow } from "./table-view-model";

type GroupRow = Extract<TaskTableDisplayRow, { kind: "group" }>;

export interface TaskTableGroupRowProps extends ComponentProps<typeof TableRow> {
  group: GroupRow;
  /** A select property option's stored colour; the dot matches its chips. */
  color?: string;
  colSpan: number;
  onToggle: () => void;
}

/** Sticky group header control — horizontal scroll keeps the label readable. */
export function TaskTableGroupRow({
  group,
  color,
  colSpan,
  onToggle,
  ...rowProps
}: TaskTableGroupRowProps) {
  return (
    <TableRow
      {...rowProps}
      className="bg-muted/40 hover:bg-muted/60"
      onClick={onToggle}
    >
      <TableCell colSpan={colSpan} className="h-9 px-4 py-1.5">
        <button
          type="button"
          className="sticky left-4 flex w-fit items-center gap-2 text-caption font-medium"
        >
          {group.collapsed ? (
            <ChevronRight className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )}
          {color ? (
            <span
              aria-hidden
              data-slot="group-color"
              className={cn("size-2 shrink-0 rounded-full", tintSolidClass[tintFromColor(color)])}
            />
          ) : null}
          {group.label}
          <span className="font-normal tabular-nums text-muted-foreground">
            {group.count}
          </span>
        </button>
      </TableCell>
    </TableRow>
  );
}
