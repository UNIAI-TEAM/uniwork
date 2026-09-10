"use client";

import { MoreHorizontal, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskStatus } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { STATUS_CONFIG } from "./status-config";

export function SwimlaneStatusHeader({
  statuses,
  totals,
  gridStyle,
  onHideStatus,
}: {
  statuses: readonly TaskStatus[];
  totals: Readonly<Record<string, number>>;
  gridStyle: React.CSSProperties;
  onHideStatus: (status: TaskStatus) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="sticky top-0 z-10 mb-2 bg-background/95 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="grid" style={gridStyle}>
        {statuses.map((status) => {
          const config = STATUS_CONFIG[status];
          return (
            <div
              key={status}
              data-testid={`swimlane-status-${status}`}
              className={cn(
                "flex items-center justify-between rounded-xl px-3 py-2",
                config?.columnBg ?? "bg-muted/40",
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "size-2.5 shrink-0 rounded-full bg-current",
                    config?.iconColor ?? "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <span className="truncate text-caption font-semibold">
                  {t(`tasks.status_${status}`)}
                </span>
                <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                  {totals[status] ?? 0}
                </span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("tasks.surface.hide_column")}
                      className="rounded-full text-muted-foreground"
                    />
                  }
                >
                  <MoreHorizontal className="size-3.5" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onHideStatus(status)}>
                    <EyeOff className="size-3.5" aria-hidden />
                    {t("tasks.surface.hide_column")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </div>
    </div>
  );
}
