"use client";

import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { MeetingPersonAvatar } from "../meeting-person";
import { MeetingAssigneeSelect } from "../meeting-assignee-select";

export function MeetingActionItemRow({
  title,
  owner,
  due,
  checked,
  selectable,
  onCheckedChange,
  workspaceId,
  assigneeId,
  onAssigneeChange,
  assigneePreviewName,
}: {
  title: string;
  owner?: string;
  due?: string;
  checked?: boolean;
  selectable?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  workspaceId?: string;
  assigneeId?: string;
  onAssigneeChange?: (userId: string | undefined) => void;
  assigneePreviewName?: string;
}) {
  return (
    <li className="flex items-start gap-2.5 rounded-xl border border-border bg-surface-hover/30 px-3 py-2.5">
      {selectable ? (
        <Checkbox
          className="mt-0.5"
          aria-label={title}
          checked={checked}
          onCheckedChange={(v) => onCheckedChange?.(v === true)}
        />
      ) : null}
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-body text-foreground">{title}</p>
        {selectable && workspaceId && onAssigneeChange && checked ? (
          <MeetingAssigneeSelect
            workspaceId={workspaceId}
            value={assigneeId}
            suggestedOwner={assigneePreviewName ?? owner}
            onChange={onAssigneeChange}
            className="h-8 w-full max-w-xs"
          />
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {owner && !selectable ? (
          <MeetingPersonAvatar name={owner} size="sm" className="size-7" />
        ) : null}
        {assigneePreviewName && selectable ? (
          <span className="text-caption text-muted-foreground">{assigneePreviewName}</span>
        ) : null}
        {due ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground tabular-nums">
            {due}
          </span>
        ) : null}
      </div>
    </li>
  );
}
