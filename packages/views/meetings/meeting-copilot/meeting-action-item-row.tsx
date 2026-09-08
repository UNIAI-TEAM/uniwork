"use client";

import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { MeetingPersonAvatar } from "../meeting-person";

export function MeetingActionItemRow({
  title,
  owner,
  due,
  checked,
  selectable,
  onCheckedChange,
}: {
  title: string;
  owner?: string;
  due?: string;
  checked?: boolean;
  selectable?: boolean;
  onCheckedChange?: (checked: boolean) => void;
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
      <div className="min-w-0 flex-1">
        <p className="text-body text-foreground">{title}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {owner ? (
          <MeetingPersonAvatar name={owner} size="sm" className="size-7" />
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
