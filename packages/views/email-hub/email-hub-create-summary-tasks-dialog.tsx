"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, Flag, FolderKanban, ListChecks, Sparkles, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubSummaryActionItem } from "@uniwork/core/types/email-hub";
import type { TaskPriority } from "@uniwork/core/types";
import { TASK_PRIORITIES } from "@uniwork/core/types";
import type { SummaryTaskFieldOverrides } from "@uniwork/core/meetings/summary-task-items";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { DateField } from "../common/date-field";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
import { CreateTaskPriorityField } from "../tasks/pickers/create-task-property-fields";
import { MeetingAssigneeSelect } from "../meetings/meeting-assignee-select";
import { dueHintToDateInput } from "./email-hub-summary-task-due";
import { EmailHubTaskProjectSelect } from "./email-hub-task-project-select";

export type EmailHubSummaryTaskDraft = {
  assigneeId?: string;
  priority: TaskPriority;
  dueDate?: string;
};

function FieldBlock({
  icon: Icon,
  label,
  htmlFor,
  children,
  className,
}: {
  icon: typeof UserRound;
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <Label htmlFor={htmlFor} className="text-caption font-medium text-muted-foreground">
          {label}
        </Label>
      </div>
      {children}
    </div>
  );
}

function SummaryTaskEditorCard({
  wsId,
  index,
  position,
  total,
  item,
  draft,
  assigneeId,
  priorityItems,
  onAssigneeChange,
  onPriorityChange,
  onDueChange,
}: {
  wsId: string;
  index: number;
  position: number;
  total: number;
  item: EmailHubSummaryActionItem;
  draft: EmailHubSummaryTaskDraft;
  assigneeId?: string;
  priorityItems: { value: string; label: string }[];
  onAssigneeChange: (userId: string | undefined) => void;
  onPriorityChange: (priority: TaskPriority) => void;
  onDueChange: (dueDate: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const dueId = `email-task-due-${index}`;

  return (
    <li
      className={cn(
        "relative overflow-hidden rounded-xl border border-border/80 bg-surface shadow-sm",
        "before:pointer-events-none before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r-full before:bg-brand",
      )}
    >
      <div className="space-y-4 p-4 pl-4">
        <div className="flex items-start gap-3">
          {total > 1 ? (
            <span
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-caption font-semibold tabular-nums text-brand-subtle-foreground"
              aria-hidden
            >
              {position}
            </span>
          ) : (
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
              <ListChecks className="size-3.5" aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-body font-semibold leading-snug text-foreground">{item.title}</p>
            {item.owner ? (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 text-caption text-muted-foreground">
                <Sparkles className="size-3 shrink-0 text-brand" aria-hidden />
                {t("email_hub.ai.suggested_owner", { name: item.owner })}
              </span>
            ) : null}
          </div>
        </div>

        <FieldBlock icon={UserRound} label={t("meetings.assignTaskTo")}>
          <MeetingAssigneeSelect
            workspaceId={wsId}
            value={assigneeId}
            suggestedOwner={item.owner}
            onChange={onAssigneeChange}
            className="h-10 w-full max-w-none rounded-lg border-border/80 bg-background shadow-none"
          />
        </FieldBlock>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBlock icon={Flag} label={t("tasks.priority")}>
            <CreateTaskPriorityField
              items={priorityItems}
              value={draft.priority}
              onChange={onPriorityChange}
            />
          </FieldBlock>
          <FieldBlock icon={CalendarDays} label={t("tasks.dueDate")} htmlFor={dueId}>
            <DateField
              id={dueId}
              modal={false}
              className="h-10 w-full rounded-lg border-border/80 bg-background shadow-none"
              value={draft.dueDate ?? ""}
              onChange={(v) => onDueChange(v || undefined)}
            />
          </FieldBlock>
        </div>
      </div>
    </li>
  );
}

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
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId);
  const [assignees, setAssignees] = useState<Record<number, string | undefined>>({});
  const [drafts, setDrafts] = useState<Record<number, EmailHubSummaryTaskDraft>>({});

  const priorityItems = useMemo(
    () => TASK_PRIORITIES.map((priority) => ({ value: priority, label: t(`tasks.priority_${priority}`) })),
    [t],
  );

  useEffect(() => {
    if (!open) return;
    setProjectId(initialProjectId);
    setAssignees({ ...initialAssignees });
    const next: Record<number, EmailHubSummaryTaskDraft> = {};
    for (const index of pickedIndices) {
      const item = actionItems[index];
      if (!item) continue;
      next[index] = {
        assigneeId: initialAssignees[index],
        priority: "medium",
        dueDate: dueHintToDateInput(item.due),
      };
    }
    setDrafts(next);
  }, [open, pickedIndices, actionItems, initialAssignees, initialProjectId]);

  const count = pickedIndices.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="lg" className="sm:max-w-xl">
        <FormDialogHeader
          title={
            <span className="flex items-center gap-2.5">
              <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-subtle text-brand shadow-sm">
                <ListChecks className="size-4" aria-hidden />
              </span>
              {t("email_hub.ai.create_dialog_title")}
            </span>
          }
          description={t("email_hub.ai.create_dialog_description", { count })}
        />

        <FormDialogBody className="space-y-5">
          <section className="rounded-xl border border-border/70 bg-muted/25 p-4">
            <FieldBlock icon={FolderKanban} label={t("email_hub.ai.project_label")}>
              <EmailHubTaskProjectSelect
                workspaceId={wsId}
                value={projectId}
                onChange={setProjectId}
                className="h-10 w-full max-w-none rounded-lg border-border/80 bg-background shadow-none"
              />
            </FieldBlock>
          </section>

          <ul className="space-y-3">
            {pickedIndices.map((index, position) => {
              const item = actionItems[index];
              const draft = drafts[index];
              if (!item || !draft) return null;
              return (
                <SummaryTaskEditorCard
                  key={`${item.title}-${index}`}
                  wsId={wsId}
                  index={index}
                  position={position + 1}
                  total={count}
                  item={item}
                  draft={draft}
                  assigneeId={assignees[index]}
                  priorityItems={priorityItems}
                  onAssigneeChange={(userId) => {
                    setAssignees((prev) => ({ ...prev, [index]: userId }));
                    setDrafts((prev) => ({
                      ...prev,
                      [index]: { ...prev[index]!, assigneeId: userId },
                    }));
                  }}
                  onPriorityChange={(priority) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [index]: { ...prev[index]!, priority },
                    }))
                  }
                  onDueChange={(dueDate) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [index]: { ...prev[index]!, dueDate },
                    }))
                  }
                />
              );
            })}
          </ul>
        </FormDialogBody>

        <FormDialogFooter
          onCancel={() => onOpenChange(false)}
          submitLabel={t("email_hub.ai.create_tasks_confirm", { count })}
          submitting={pending}
          submitDisabled={count === 0}
          onSubmit={() => {
            const fields: SummaryTaskFieldOverrides = {};
            for (const index of pickedIndices) {
              const draft = drafts[index];
              if (!draft) continue;
              fields[index] = {
                priority: draft.priority,
                due_date: draft.dueDate,
              };
            }
            onConfirm({ projectId, assignees, fields });
          }}
        />
      </FormDialogContent>
    </Dialog>
  );
}
