"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CreateTaskBody } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import {
  agentDialogContentClass,
  manualDialogContentClass,
} from "./create-task-dialog-classes";
import { CreateTaskAgentPanel } from "./create-task-agent-panel";
import { CreateTaskManualPanel } from "./create-task-manual-panel";

export type CreateTaskMode = "manual" | "agent";

export type CreateTaskDialogProps = {
  workspaceId: string;
  defaults?: Partial<CreateTaskBody>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  initialMode?: CreateTaskMode;
};

/**
 * Shell that owns the single Dialog + DialogContent for create-task.
 * Mode switching remounts only the inner panel — Portal/Overlay/Popup stay
 * mounted so Base UI does not replay the open animation.
 */
export function CreateTaskDialog({
  workspaceId,
  defaults,
  open: openProp,
  onOpenChange,
  showTrigger = true,
  initialMode,
}: CreateTaskDialogProps) {
  const { t } = useTranslation();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [mode, setMode] = useState<CreateTaskMode>(initialMode ?? "manual");
  const [carry, setCarry] = useState<Record<string, unknown> | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [createAnother, setCreateAnother] = useState(false);

  const switchTo = (next: CreateTaskMode) => (nextCarry?: Record<string, unknown> | null) => {
    setCarry(nextCarry ?? null);
    setMode(next);
  };

  const contentClass =
    mode === "agent"
      ? agentDialogContentClass(isExpanded)
      : manualDialogContentClass(isExpanded);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger ? (
        <DialogTrigger render={<Button size="sm">{t("tasks.new")}</Button>} />
      ) : null}
      <DialogContent showCloseButton={false} className={contentClass}>
        {mode === "manual" ? (
          <CreateTaskManualPanel
            workspaceId={workspaceId}
            defaults={defaults}
            carry={carry}
            onClose={() => setOpen(false)}
            onSwitchMode={switchTo("agent")}
            isExpanded={isExpanded}
            setIsExpanded={setIsExpanded}
            createAnother={createAnother}
            setCreateAnother={setCreateAnother}
          />
        ) : (
          <CreateTaskAgentPanel
            workspaceId={workspaceId}
            carry={carry}
            onClose={() => setOpen(false)}
            onSwitchMode={switchTo("manual")}
            isExpanded={isExpanded}
            setIsExpanded={setIsExpanded}
            createAnother={createAnother}
            setCreateAnother={setCreateAnother}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
