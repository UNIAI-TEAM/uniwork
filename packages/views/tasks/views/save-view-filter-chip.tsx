"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FilterDimension } from "@uniwork/core/tasks/stores/view-store-types";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@uniwork/ui/components/ui/avatar";
import { PriorityFlag, StatusIcon } from "../modes/status-pill";

export const SAVE_VIEW_CHIP_ICON =
  "size-3 shrink-0 text-muted-foreground";

export interface SaveViewFilterChip {
  key: string;
  dimension: FilterDimension;
  icon: ReactNode;
  label: string;
  preview?: ReactNode;
  value: string;
}

export function SaveViewFilterChipView({
  chip,
  onRemove,
}: {
  chip: SaveViewFilterChip;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <span className="flex h-6 max-w-72 items-center gap-1.5 rounded-md bg-background pl-2 pr-1 text-caption shadow-xs">
      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
        {chip.icon}
        <span>{chip.label}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1">
        {chip.preview}
        <span className="truncate font-medium">{chip.value}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={t("tasks.filters.remove_chip", { label: chip.label })}
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

export function SaveViewStatusPreview({ statuses }: { statuses: string[] }) {
  return (
    <span className="flex items-center -space-x-1" aria-hidden>
      {statuses.slice(0, 2).map((status) => (
        <span
          key={status}
          className="inline-flex size-4 items-center justify-center rounded-full bg-background ring-1 ring-border"
        >
          <StatusIcon status={status} className="size-3" />
        </span>
      ))}
    </span>
  );
}

export function SaveViewPriorityPreview({
  priorities,
}: {
  priorities: string[];
}) {
  return (
    <span className="flex items-center -space-x-1" aria-hidden>
      {priorities.slice(0, 2).map((priority) => (
        <span
          key={priority}
          className="inline-flex size-4 items-center justify-center rounded-full bg-background ring-1 ring-border"
        >
          <PriorityFlag priority={priority} className="size-3" />
        </span>
      ))}
    </span>
  );
}

export function SaveViewActorPreview({
  actors,
}: {
  actors: Array<{ id: string; name: string; avatarUrl?: string }>;
}) {
  return (
    <span className="flex items-center -space-x-1" aria-hidden>
      {actors.slice(0, 2).map((actor) => (
        <Avatar key={actor.id} size="sm" className="size-4 ring-1 ring-border">
          {actor.avatarUrl ? (
            <AvatarImage src={actor.avatarUrl} alt="" />
          ) : null}
          <AvatarFallback className="text-caption">
            {actor.name.trim().charAt(0).toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>
      ))}
    </span>
  );
}
