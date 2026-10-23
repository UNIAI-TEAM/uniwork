"use client";

import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { TableCell, TableRow } from "@uniwork/ui/components/ui/table";

export interface TaskTableBranchErrorRowProps extends ComponentProps<typeof TableRow> {
  colSpan: number;
  depth?: number;
  onRetry?: () => void;
}

/**
 * A branch (a group's rows, a parent's sub-tasks, a later page) that failed to
 * load: says so where its rows would be and asks it again in place, leaving the
 * rest of the table as it is.
 */
export function TaskTableBranchErrorRow({
  colSpan,
  depth,
  onRetry,
  ...rowProps
}: TaskTableBranchErrorRowProps) {
  const { t } = useTranslation();
  return (
    <TableRow {...rowProps} className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="h-9 px-4 py-1.5">
        <div
          className="sticky left-4 flex w-fit items-center gap-3"
          style={depth ? { paddingLeft: depth * 16 } : undefined}
        >
          <span className="text-caption text-destructive">{t("tasks.table.branch_error")}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onRetry?.();
            }}
          >
            {t("tasks.table.load_more_retry")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
