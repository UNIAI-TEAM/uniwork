"use client";

import {
  ChartGantt,
  Columns3,
  List,
  Table2,
  Waves,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import type { TaskViewMode } from "@uniwork/core/tasks/stores/view-store-types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import type { TaskSurfaceMode } from "../surface/types";

const MODE_ICON: Record<TaskSurfaceMode, typeof List> = {
  board: Columns3,
  list: List,
  table: Table2,
  gantt: ChartGantt,
  swimlane: Waves,
};

const MODE_LABEL_KEY: Record<TaskSurfaceMode, string> = {
  board: "tasks.view.board",
  list: "tasks.view.list",
  table: "tasks.view.table",
  gantt: "tasks.view.gantt",
  swimlane: "tasks.view.swimlane",
};

const MODE_TOOLTIP_KEY: Record<TaskSurfaceMode, string> = {
  board: "tasks.view.tooltip_board",
  list: "tasks.view.tooltip_list",
  table: "tasks.view.tooltip_table",
  gantt: "tasks.view.tooltip_gantt",
  swimlane: "tasks.view.tooltip_swimlane",
};

export function TaskModeSwitcher({ modes }: { modes: TaskSurfaceMode[] }) {
  const { t } = useTranslation();
  const viewMode = useViewStore((s) => s.viewMode);
  const setViewMode = useViewStore((s) => s.setViewMode);
  const allowed = new Set(modes);
  const effective: TaskSurfaceMode = allowed.has(viewMode as TaskSurfaceMode)
    ? (viewMode as TaskSurfaceMode)
    : (modes[0] ?? "list");
  const Icon = MODE_ICON[effective];

  return (
    <DropdownMenu>
      <Tooltip>
        <DropdownMenuTrigger
          render={
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  aria-haspopup="menu"
                  aria-label={t(MODE_LABEL_KEY[effective])}
                  data-testid="task-mode-switcher"
                />
              }
            />
          }
        >
          <Icon className="size-3.5" aria-hidden />
          <span className="hidden md:inline">{t(MODE_LABEL_KEY[effective])}</span>
        </DropdownMenuTrigger>
        <TooltipContent side="bottom">
          {t(MODE_TOOLTIP_KEY[effective])}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="w-auto"
        aria-label={t("tasks.view.section")}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("tasks.view.section")}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuRadioGroup
          value={effective}
          onValueChange={(value) => {
            if (allowed.has(value as TaskSurfaceMode)) {
              setViewMode(value as TaskViewMode);
            }
          }}
        >
          {modes.map((mode) => {
            const ModeIcon = MODE_ICON[mode];
            return (
              <DropdownMenuRadioItem
                key={mode}
                value={mode}
                data-testid={`task-mode-${mode}`}
              >
                <ModeIcon className="size-3.5" aria-hidden />
                {t(MODE_LABEL_KEY[mode])}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
