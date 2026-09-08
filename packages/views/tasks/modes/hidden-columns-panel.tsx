"use client";

import { Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskStatus } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { useViewStoreApi } from "@uniwork/core/tasks/stores/view-store-context";
import { STATUS_CONFIG } from "./status-config";

/**
 * Side panel listing status columns the user hid from the board.
 */
export function HiddenColumnsPanel({
  hiddenStatuses,
  taskCounts,
}: {
  hiddenStatuses: readonly string[];
  taskCounts?: Record<string, number>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-[240px] shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-body font-medium text-muted-foreground">
          {t("tasks.surface.hidden_columns")}
        </span>
      </div>
      <div className="flex-1 space-y-0.5">
        {hiddenStatuses.map((status) => (
          <HiddenColumnRow
            key={status}
            status={status}
            total={taskCounts?.[status]}
          />
        ))}
      </div>
    </div>
  );
}

function HiddenColumnRow({
  status,
  total,
}: {
  status: string;
  total?: number;
}) {
  const { t } = useTranslation();
  const viewStoreApi = useViewStoreApi();
  const labelKey = `tasks.status_${status}`;
  const label = t(labelKey);
  const title = label === labelKey ? status : label;
  const cfg = STATUS_CONFIG[status as TaskStatus];

  return (
    <div className="flex items-center justify-between rounded-lg px-2.5 py-2 hover:bg-muted/50">
      <div className="flex items-center gap-2">
        <span
          className={`size-2.5 shrink-0 rounded-full ${cfg?.iconColor ?? "bg-muted-foreground"} bg-current`}
          aria-hidden
        />
        <span className="text-body">{title}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {total !== undefined ? (
          <span className="text-caption text-muted-foreground">{total}</span>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("tasks.surface.show_column")}
                className="rounded-full text-muted-foreground"
              >
                <Eye className="size-3.5" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() =>
                viewStoreApi.getState().showStatus(status as TaskStatus)
              }
            >
              <Eye className="size-3.5" />
              {t("tasks.surface.show_column")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
