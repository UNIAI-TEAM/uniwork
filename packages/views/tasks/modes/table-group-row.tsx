"use client";

import type { ComponentProps } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  TableCell,
  TableRow,
} from "@uniwork/ui/components/ui/table";
import type { TaskTableDisplayRow } from "./table-view-model";

type GroupRow = Extract<TaskTableDisplayRow, { kind: "group" }>;

export interface TaskTableGroupRowProps extends ComponentProps<typeof TableRow> {
  group: GroupRow;
  colSpan: number;
  onToggle: () => void;
}

/** Sticky group header control — horizontal scroll keeps the label readable. */
export function TaskTableGroupRow({
  group,
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
          {group.label}
          <span className="font-normal tabular-nums text-muted-foreground">
            {group.count}
          </span>
        </button>
      </TableCell>
    </TableRow>
  );
}
