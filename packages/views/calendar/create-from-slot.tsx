"use client";

import { useMemo } from "react";
import { CreateTaskDialog } from "../tasks/create-task-dialog";
import { taskDefaultsFromSlot, type CalendarSlot } from "./slot-prefill";

export function CreateFromSlot({
  workspaceId,
  open,
  onOpenChange,
  slot,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: CalendarSlot | null;
}) {
  const taskDefaults = useMemo(
    () => (slot ? taskDefaultsFromSlot(slot) : undefined),
    [slot],
  );

  return (
    <CreateTaskDialog
      workspaceId={workspaceId}
      defaults={taskDefaults}
      open={open}
      onOpenChange={onOpenChange}
      showTrigger={false}
    />
  );
}
