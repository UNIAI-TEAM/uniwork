"use client";

import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  TableCell,
  TableRow,
} from "@uniwork/ui/components/ui/table";
import { TaskTableBranchErrorRow } from "./table-branch-error-row";
import type { TaskTableDisplayRow } from "./table-view-model";

type LoadMoreRow = Extract<TaskTableDisplayRow, { kind: "load_more" }>;

export interface TaskTableLoadMoreRowProps
  extends ComponentProps<typeof TableRow> {
  row: LoadMoreRow;
  colSpan: number;
}

/**
 * End-of-branch control — pages the rows API when the total exceeds what is
 * loaded; a failed branch shows its error row with a retry instead.
 */
export function TaskTableLoadMoreRow({
  row,
  colSpan,
  ...rowProps
}: TaskTableLoadMoreRowProps) {
  const { t } = useTranslation();
  if (row.state === "error") {
    return (
      <TaskTableBranchErrorRow {...rowProps} colSpan={colSpan} depth={row.depth} onRetry={row.onLoad} />
    );
  }
  const truncated = t("tasks.table.showing_of_total", {
    shown: row.loadedCount,
    total: row.total,
  });

  return (
    <TableRow {...rowProps} className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="h-9 px-4 py-1.5">
        <div
          className="sticky left-4 flex w-fit items-center gap-3"
          style={row.depth ? { paddingLeft: row.depth * 16 } : undefined}
        >
          <span className="text-caption text-muted-foreground">{truncated}</span>
          {row.state === "has_more" || row.state === "loading" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={row.state === "loading"}
              onClick={(event) => {
                event.stopPropagation();
                row.onLoad?.();
              }}
            >
              {row.state === "loading"
                ? t("tasks.table.loading_more")
                : t("tasks.table.load_more")}
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
