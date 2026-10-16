"use client";

import { useState, type ReactNode } from "react";
import { CalendarDays, Flag, FolderKanban, ListChecks, Sparkles, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskPriority } from "@uniwork/core/types";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../common/date-field";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import { MeetingAssigneeSelect } from "../meetings/meeting-assignee-select";
import { ProjectSelect } from "../projects/components/project-select";
import { PriorityPicker } from "./pickers/priority-picker";

const FIELD_CLASS = "h-9 w-full max-w-none";

/** What the person confirms for one AI action item. null is "nobody" / "no due date", a choice. */
export interface AiSummaryTaskDraft {
  assigneeId: string | null;
  priority: TaskPriority;
  dueDate: string | null;
}

/** One picked action item and the values the dialog opens with. */
export interface AiSummaryTaskSeed {
  index: number;
  title: string;
  /** The owner the AI wrote, shown as its suggestion. */
  owner?: string | null;
  /** The due phrase the AI wrote, shown beside the date it was read as. */
  due?: string | null;
  draft: AiSummaryTaskDraft;
}

/** The words that differ between the screens using the dialog (Email Hub, meetings). */
export interface AiSummaryTasksDialogCopy {
  title: string;
  description: string;
  projectLabel: string;
  projectNone: string;
  unassignedLabel: string;
  suggestedOwner: (name: string) => string;
  spokenDue?: (due: string) => string;
  submit: string;
  submitting?: string;
}

function FieldBlock({
  icon: Icon,
  label,
  htmlFor,
  children,
}: {
  icon: typeof UserRound;
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
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

function TaskEditorCard({
  wsId,
  idPrefix,
  seed,
  position,
  total,
  draft,
  copy,
  onChange,
}: {
  wsId: string;
  idPrefix: string;
  seed: AiSummaryTaskSeed;
  position: number;
  total: number;
  draft: AiSummaryTaskDraft;
  copy: AiSummaryTasksDialogCopy;
  onChange: (patch: Partial<AiSummaryTaskDraft>) => void;
}) {
  const { t } = useTranslation();
  const dueId = `${idPrefix}-due-${seed.index}`;
  const owner = seed.owner?.trim();
  const due = seed.due?.trim();

  return (
    <li className="rounded-lg border border-border bg-surface">
      <div className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          {total > 1 ? (
            <span
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-caption font-semibold tabular-nums text-muted-foreground"
              aria-hidden
            >
              {position}
            </span>
          ) : (
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <ListChecks className="size-3.5" aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-body font-semibold leading-snug text-foreground">{seed.title}</p>
            {owner || (due && copy.spokenDue) ? (
              <div className="flex flex-wrap gap-1.5">
                {owner ? (
                  <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-brand-subtle px-1.5 py-0.5 text-caption text-brand-subtle-foreground">
                    <Sparkles className="size-3 shrink-0" aria-hidden />
                    {copy.suggestedOwner(owner)}
                  </span>
                ) : null}
                {due && copy.spokenDue ? (
                  <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-brand-subtle px-1.5 py-0.5 text-caption text-brand-subtle-foreground">
                    <Sparkles className="size-3 shrink-0" aria-hidden />
                    {copy.spokenDue(due)}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <FieldBlock icon={UserRound} label={t("meetings.assignTaskTo")}>
          <MeetingAssigneeSelect
            workspaceId={wsId}
            value={draft.assigneeId ?? undefined}
            onChange={(userId) => onChange({ assigneeId: userId ?? null })}
            unassignedLabel={copy.unassignedLabel}
            className={FIELD_CLASS}
          />
        </FieldBlock>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBlock icon={Flag} label={t("tasks.priority")}>
            <PriorityPicker
              value={draft.priority}
              ariaLabel={t("tasks.priority")}
              triggerClassName={cn(FIELD_CLASS, "justify-start gap-1.5 border border-input px-2.5 font-normal")}
              onChange={(priority) => onChange({ priority })}
            />
          </FieldBlock>
          <FieldBlock icon={CalendarDays} label={t("tasks.dueDate")} htmlFor={dueId}>
            <DateField
              id={dueId}
              modal={false}
              className={FIELD_CLASS}
              value={draft.dueDate ?? ""}
              onChange={(v) => onChange({ dueDate: v || null })}
            />
          </FieldBlock>
        </div>
      </div>
    </li>
  );
}

/**
 * The form inside the dialog. Keyed per opening, so each opening starts from
 * the seeds, and a seed that changes while it is open does not overwrite what
 * the person typed.
 */
function AiSummaryTasksForm({
  wsId,
  idPrefix,
  seeds,
  initialProjectId,
  copy,
  pending,
  onCancel,
  onConfirm,
}: {
  wsId: string;
  idPrefix: string;
  seeds: readonly AiSummaryTaskSeed[];
  initialProjectId?: string;
  copy: AiSummaryTasksDialogCopy;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (input: { projectId?: string; drafts: Record<number, AiSummaryTaskDraft> }) => void;
}) {
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId);
  const [drafts, setDrafts] = useState<Record<number, AiSummaryTaskDraft>>(() =>
    Object.fromEntries(seeds.map((s) => [s.index, s.draft])),
  );

  return (
    <>
      <FormDialogHeader title={copy.title} description={copy.description} />
      <FormDialogBody className="space-y-5">
        <section>
          <FieldBlock icon={FolderKanban} label={copy.projectLabel}>
            <ProjectSelect
              workspaceId={wsId}
              value={projectId}
              onChange={setProjectId}
              noneLabel={copy.projectNone}
              ariaLabel={copy.projectLabel}
              size="sm"
              className={FIELD_CLASS}
            />
          </FieldBlock>
        </section>
        <ul className="space-y-3">
          {seeds.map((seed, position) => {
            const draft = drafts[seed.index] ?? seed.draft;
            return (
              <TaskEditorCard
                key={seed.index}
                wsId={wsId}
                idPrefix={idPrefix}
                seed={seed}
                position={position + 1}
                total={seeds.length}
                draft={draft}
                copy={copy}
                onChange={(patch) =>
                  setDrafts((prev) => ({ ...prev, [seed.index]: { ...(prev[seed.index] ?? seed.draft), ...patch } }))
                }
              />
            );
          })}
        </ul>
      </FormDialogBody>
      <FormDialogFooter
        onCancel={onCancel}
        submitLabel={copy.submit}
        submittingLabel={copy.submitting}
        submitting={pending}
        submitDisabled={seeds.length === 0}
        onSubmit={() => onConfirm({ projectId, drafts })}
      />
    </>
  );
}

/**
 * Review AI action items before they become tasks: who, when, how urgent and
 * in which project, per item. Shared by Email Hub and meetings; each screen
 * supplies its seeds (its own suggestions) and its words.
 *
 * The popup fades out after `open` turns false, and a caller usually clears
 * its selection in the same update, so the form keeps the seeds and words it
 * last showed open until the popup is gone instead of fading out empty. Each
 * opening remounts the form, starting it from the current seeds.
 */
export function AiSummaryTasksDialog({
  open,
  onOpenChange,
  wsId,
  idPrefix,
  seeds,
  initialProjectId,
  copy,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  /** Prefix for field ids, unique per screen. */
  idPrefix: string;
  seeds: readonly AiSummaryTaskSeed[];
  initialProjectId?: string;
  copy: AiSummaryTasksDialogCopy;
  pending: boolean;
  onConfirm: (input: { projectId?: string; drafts: Record<number, AiSummaryTaskDraft> }) => void;
}) {
  const [opening, setOpening] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  const [shown, setShown] = useState({ seeds, copy });
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpening((n) => n + 1);
  }
  if (open && (shown.seeds !== seeds || shown.copy !== copy)) {
    setShown({ seeds, copy });
  }
  const view = open ? { seeds, copy } : shown;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="lg" className="sm:max-w-xl">
        <AiSummaryTasksForm
          key={opening}
          wsId={wsId}
          idPrefix={idPrefix}
          seeds={view.seeds}
          initialProjectId={initialProjectId}
          copy={view.copy}
          pending={pending}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      </FormDialogContent>
    </Dialog>
  );
}
