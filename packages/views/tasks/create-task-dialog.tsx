"use client";

import { useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import type { CreateTaskBody } from "@uniwork/core/tasks";
import {
  hasMeaningfulCreateTaskDraft,
  useCreateTaskDraftStore,
} from "@uniwork/core/tasks/stores/create-task-draft-store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import {
  agentDialogContentClass,
  manualDialogContentClass,
} from "./create-task-dialog-classes";
import { CreateTaskAgentPanel } from "./create-task-agent-panel";
import { CreateTaskManualPanel, type CreateTaskManualPanelProps } from "./create-task-manual-panel";

export type CreateTaskMode = "manual" | "agent";

export type CreateTaskDialogProps = {
  workspaceId: string;
  defaults?: Partial<CreateTaskBody>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  initialMode?: CreateTaskMode;
  /** Where focus goes on close (Base UI `finalFocus`): the title's autoFocus hides the opener from it. */
  finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"];
} & Pick<CreateTaskManualPanelProps, "submitter" | "heading">;

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
  submitter,
  heading,
  finalFocus,
}: CreateTaskDialogProps) {
  const { t } = useTranslation();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const closeDraft = useCreateTaskDraftStore((state) => state.closeDraft);
  const clearDraft = useCreateTaskDraftStore((state) => state.clearDraft);
  const saveDraft = useCreateTaskDraftStore((state) => state.saveDraft);
  const activeDraft = useCreateTaskDraftStore((state) => {
    const draftId = state.activeDraftIds[workspaceId];
    return draftId ? state.drafts[workspaceId]?.[draftId] ?? null : null;
  });
  const [mode, setMode] = useState<CreateTaskMode>(initialMode ?? "manual");
  const [carry, setCarry] = useState<Record<string, unknown> | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [createAnother, setCreateAnother] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  const switchTo = (next: CreateTaskMode) => (nextCarry?: Record<string, unknown> | null) => {
    setCarry(nextCarry ?? null);
    setMode(next);
  };

  const contentClass =
    mode === "agent"
      ? agentDialogContentClass(isExpanded)
      : manualDialogContentClass(isExpanded);

  // A submitter's composer keeps no draft: the workspace's active one is the person's own.
  const closeImmediately = () => {
    if (!submitter) closeDraft(workspaceId);
    setOpen(false);
  };

  const requestClose = (skipConfirm = false) => {
    if (
      !skipConfirm &&
      !submitter &&
      activeDraft &&
      !activeDraft.savedAt &&
      hasMeaningfulCreateTaskDraft(activeDraft)
    ) {
      setCloseConfirmOpen(true);
      return;
    }
    closeImmediately();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) setOpen(true);
    else requestClose();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        {showTrigger ? (
          <DialogTrigger render={<Button size="sm">{t("tasks.new")}</Button>} />
        ) : null}
        <DialogContent showCloseButton={false} className={contentClass} finalFocus={finalFocus}>
          {mode === "manual" ? (
            <CreateTaskManualPanel
              workspaceId={workspaceId}
              defaults={defaults}
              carry={carry}
              onClose={(reason) => requestClose(reason === "saved" || reason === "submitted")}
              onSwitchMode={switchTo("agent")}
              isExpanded={isExpanded}
              setIsExpanded={setIsExpanded}
              createAnother={createAnother}
              setCreateAnother={setCreateAnother}
              submitter={submitter}
              heading={heading}
            />
          ) : (
            <CreateTaskAgentPanel
              workspaceId={workspaceId}
              carry={carry}
              onClose={(reason) => requestClose(reason === "saved" || reason === "submitted")}
              onSwitchMode={switchTo("manual")}
              isExpanded={isExpanded}
              setIsExpanded={setIsExpanded}
              createAnother={createAnother}
              setCreateAnother={setCreateAnother}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AlertDialogContent nested>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tasks.create.close_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tasks.create.close_confirm_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between">
            <AlertDialogAction
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                if (activeDraft) clearDraft(workspaceId, activeDraft.idempotencyKey);
                setCloseConfirmOpen(false);
                setOpen(false);
              }}
            >
              {t("tasks.create.discard_draft")}
            </AlertDialogAction>
            <div className="flex gap-2">
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (activeDraft) saveDraft(workspaceId, activeDraft);
                  setCloseConfirmOpen(false);
                  closeDraft(workspaceId);
                  setOpen(false);
                }}
              >
                {t("common.save")}
              </AlertDialogAction>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
