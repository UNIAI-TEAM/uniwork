"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Task, TaskPriority, TaskStatus } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { PriorityPicker, StatusPicker } from "../pickers";

type BatchUpdates = {
  status?: string;
  priority?: string;
  assignee_id?: string | null;
  assignee_kind?: string;
};

export function BatchStatusPicker({
  status,
  disabled,
  onUpdate,
}: {
  status: string | null;
  disabled?: boolean;
  onUpdate: (updates: BatchUpdates) => void;
}) {
  const { t } = useTranslation();
  const label = t("tasks.batch.status");
  return (
    <>
      {/* Trigger shows the fixed action label, not the current value: a
          multi-task selection may carry mixed statuses, so there is no
          single value to display. */}
      <span data-testid="batch-status-value" data-status={status ?? "__none__"} hidden />
      <StatusPicker
        value={status as TaskStatus | null}
        disabled={disabled}
        ariaLabel={label}
        align="center"
        onChange={(value) => onUpdate({ status: value })}
      >
        {label}
      </StatusPicker>
    </>
  );
}

export function BatchPriorityPicker({
  priority,
  disabled,
  onUpdate,
}: {
  priority: string | null;
  disabled?: boolean;
  onUpdate: (updates: BatchUpdates) => void;
}) {
  const { t } = useTranslation();
  const label = t("tasks.batch.priority");
  return (
    <PriorityPicker
      value={priority as TaskPriority | null}
      disabled={disabled}
      ariaLabel={label}
      align="center"
      onChange={(value) => onUpdate({ priority: value })}
    >
      {label}
    </PriorityPicker>
  );
}

export function BatchAssigneePicker({
  assigneeId,
  mixed,
  disabled,
  members,
  onUpdate,
}: {
  assigneeId: string | null;
  mixed?: boolean;
  disabled?: boolean;
  members: Array<{ id: string; name: string }>;
  onUpdate: (updates: BatchUpdates) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = useMemo(() => {
    if (mixed) return t("tasks.batch.assignee_mixed");
    if (!assigneeId) return t("tasks.unassigned");
    return members.find((m) => m.id === assigneeId)?.name ?? t("tasks.batch.assignee");
  }, [assigneeId, members, mixed, t]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="ghost" size="sm" disabled={disabled} />
        }
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuRadioGroup
          value={assigneeId ?? "__none__"}
          onValueChange={(value) => {
            if (value === "__none__") {
              onUpdate({ assignee_id: null, assignee_kind: "human" });
            } else {
              onUpdate({ assignee_id: value, assignee_kind: "human" });
            }
            setOpen(false);
          }}
        >
          <DropdownMenuRadioItem value="__none__">
            {t("tasks.unassigned")}
          </DropdownMenuRadioItem>
          {members.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id}>
              {m.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type { BatchUpdates, Task };
