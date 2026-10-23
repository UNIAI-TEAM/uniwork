"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { EmailHubSummaryActionItem } from "@uniwork/core/types/email-hub";
import type { SummaryTaskFieldOverrides } from "@uniwork/core/meetings/summary-task-items";
import { AiSummaryTasksDialog, type AiSummaryTaskSeed } from "../tasks/ai-summary-tasks-dialog";
import { dueHintToDateInput } from "./email-hub-summary-task-due";

/**
 * The Email Hub's review step before thread action items become tasks: the
 * shared AI summary tasks dialog, seeded with the Email Hub's own guesses
 * (the member preview, the due hint read on the client) and its words.
 */
export function EmailHubCreateSummaryTasksDialog({
  open,
  onOpenChange,
  wsId,
  pickedIndices,
  actionItems,
  initialAssignees,
  initialProjectId,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  pickedIndices: number[];
  actionItems: EmailHubSummaryActionItem[];
  initialAssignees: Record<number, string | undefined>;
  initialProjectId?: string;
  onConfirm: (input: {
    projectId?: string;
    assignees: Record<number, string | undefined>;
    fields: SummaryTaskFieldOverrides;
  }) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const count = pickedIndices.length;
  const seeds = useMemo<AiSummaryTaskSeed[]>(
    () =>
      pickedIndices.flatMap((index) => {
        const item = actionItems[index];
        if (!item) return [];
        return [
          {
            index,
            title: item.title,
            owner: item.owner,
            draft: {
              assigneeId: initialAssignees[index] ?? null,
              priority: "medium",
              dueDate: dueHintToDateInput(item.due) ?? null,
            },
          },
        ];
      }),
    [pickedIndices, actionItems, initialAssignees],
  );

  return (
    <AiSummaryTasksDialog
      open={open}
      onOpenChange={onOpenChange}
      wsId={wsId}
      idPrefix="email-task"
      seeds={seeds}
      initialProjectId={initialProjectId}
      pending={pending}
      copy={{
        title: t("email_hub.ai.create_dialog_title"),
        description: t("email_hub.ai.create_dialog_description", { count }),
        projectLabel: t("email_hub.ai.project_label"),
        projectNone: t("email_hub.ai.project_none"),
        unassignedLabel: t("email_hub.ai.unassigned"),
        suggestedOwner: (name) => t("email_hub.ai.suggested_owner", { name }),
        submit: t("email_hub.ai.create_tasks_confirm", { count }),
      }}
      onConfirm={({ projectId, drafts }) => {
        const assignees: Record<number, string | undefined> = {};
        const fields: SummaryTaskFieldOverrides = {};
        for (const index of pickedIndices) {
          const draft = drafts[index];
          if (!draft) continue;
          assignees[index] = draft.assigneeId ?? undefined;
          fields[index] = { priority: draft.priority, due_date: draft.dueDate ?? undefined };
        }
        onConfirm({ projectId, assignees, fields });
      }}
    />
  );
}
