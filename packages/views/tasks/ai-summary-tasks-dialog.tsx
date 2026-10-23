"use client";

import { useState, type ReactNode } from "react";
import { CalendarDays, CircleAlert, Flag, FolderKanban, ListChecks, PenLine, Sparkles, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskPriority } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../common/date-field";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import { MeetingAssigneeSelect } from "../meetings/meeting-assignee-select";
import { ProjectSelect } from "../projects/components/project-select";
import { PriorityPicker } from "./pickers/priority-picker";

// Every control keeps the 32px of Input and DateField; the small select
// trigger (data-[size=sm], 28px) is raised to match.
const FIELD_CLASS = "w-full max-w-none data-[size=sm]:h-8";

// What the AI read from the source: neutral, so it never reads as a selection.
const SAID_CHIP_CLASS =
  "inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-caption text-muted-foreground";

/** The same person's name as said and as picked: case and spaces aside. */
export const sameName = (a: string, b: string | undefined) => a.trim().toLowerCase() === b?.trim().toLowerCase();

/** What the person confirms for one AI action item. null is "nobody" / "no due date", a choice. */
export interface AiSummaryTaskDraft {
  assigneeId: string | null;
  priority: TaskPriority;
  dueDate: string | null;
  /** The task's title when the screen lets it be edited (copy.titleLabel); unset keeps the seed's, blank is refused. */
  title?: string;
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
  /** Set to let the person edit each title, labelled with it. */
  titleLabel?: string;
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
  note,
  onChange,
}: {
  wsId: string;
  idPrefix: string;
  seed: AiSummaryTaskSeed;
  position: number;
  total: number;
  draft: AiSummaryTaskDraft;
  copy: AiSummaryTasksDialogCopy;
  /** Why the last attempt refused this item, shown on its card. */
  note?: string;
  onChange: (patch: Partial<AiSummaryTaskDraft>) => void;
}) {
  const { t } = useTranslation();
  const { data: members } = useMembers(wsId);
  const dueId = `${idPrefix}-due-${seed.index}`;
  const titleId = `${idPrefix}-title-${seed.index}`;
  const titleErrorId = `${titleId}-error`;
  const titleBlank = draft.title !== undefined && draft.title.trim() === "";
  const picked = members?.find((m) => m.user_id === draft.assigneeId)?.display_name;
  // The owner the AI read, unless it is who the select already shows: one name, once.
  const owner = seed.owner?.trim() && !sameName(seed.owner, picked) ? seed.owner.trim() : undefined;
  const due = seed.due?.trim();

  return (
    <li className={cn("rounded-lg border bg-surface", note ? "border-destructive" : "border-border")}>
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
            {copy.titleLabel ? (
              <FieldBlock icon={PenLine} label={copy.titleLabel} htmlFor={titleId}>
                <Input
                  id={titleId}
                  className="font-semibold"
                  value={draft.title ?? seed.title}
                  aria-invalid={titleBlank || undefined}
                  aria-describedby={titleBlank ? titleErrorId : undefined}
                  onChange={(e) => onChange({ title: e.target.value })}
                />
                {titleBlank ? (
                  <p id={titleErrorId} className="flex items-center gap-1 text-caption text-destructive">
                    <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                    {t("tasks.summary_title_required")}
                  </p>
                ) : null}
              </FieldBlock>
            ) : (
              <p className="text-body font-semibold leading-snug text-foreground">{seed.title}</p>
            )}
            {note ? (
              <p className="flex items-center gap-1 text-caption text-destructive">
                <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                {note}
              </p>
            ) : null}
            {owner || (due && copy.spokenDue) ? (
              <div className="flex flex-wrap gap-1.5">
                {owner ? (
                  <span className={SAID_CHIP_CLASS}>
                    <Sparkles className="size-3 shrink-0" aria-hidden />
                    {copy.suggestedOwner(owner)}
                  </span>
                ) : null}
                {due && copy.spokenDue ? (
                  <span className={SAID_CHIP_CLASS}>
                    <Sparkles className="size-3 shrink-0" aria-hidden />
                    {copy.spokenDue(due)}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <FieldBlock icon={UserRound} label={t("tasks.assignee")}>
          <MeetingAssigneeSelect
            workspaceId={wsId}
            ariaLabel={t("tasks.assignee")}
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
              // h-8: the sm button trigger is 28px, 4px short of the date field beside it.
              triggerClassName={cn(FIELD_CLASS, "h-8 justify-start gap-1.5 border border-input px-2.5 font-normal")}
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
  itemNotes,
  pending,
  onCancel,
  onConfirm,
}: {
  wsId: string;
  idPrefix: string;
  seeds: readonly AiSummaryTaskSeed[];
  initialProjectId?: string;
  copy: AiSummaryTasksDialogCopy;
  itemNotes?: Readonly<Record<number, string>>;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (input: { projectId?: string; drafts: Record<number, AiSummaryTaskDraft> }) => void;
}) {
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId);
  const [drafts, setDrafts] = useState<Record<number, AiSummaryTaskDraft>>(() =>
    Object.fromEntries(seeds.map((s) => [s.index, s.draft])),
  );
  // A cleared title is refused on its field; it never falls back to the AI's wording unseen.
  const blankTitle = !!copy.titleLabel && seeds.some((s) => (drafts[s.index] ?? s.draft).title?.trim() === "");

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
                note={itemNotes?.[seed.index]}
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
        submitDisabled={seeds.length === 0 || blankTitle}
        onSubmit={() => {
          if (blankTitle) return;
          onConfirm({ projectId, drafts });
        }}
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
  itemNotes,
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
  /** Per item index: why the last attempt refused it, shown on its card. */
  itemNotes?: Readonly<Record<number, string>>;
  pending: boolean;
  onConfirm: (input: { projectId?: string; drafts: Record<number, AiSummaryTaskDraft> }) => void;
}) {
  const [opening, setOpening] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  const [shown, setShown] = useState({ seeds, copy, itemNotes });
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpening((n) => n + 1);
  }
  if (open && (shown.seeds !== seeds || shown.copy !== copy || shown.itemNotes !== itemNotes)) {
    setShown({ seeds, copy, itemNotes });
  }
  const view = open ? { seeds, copy, itemNotes } : shown;
  // Escape, the scrim and the close button cannot drop a review while it is being sent:
  // its answer (the duplicate marks) lands on this dialog.
  const changeOpen = (next: boolean) => {
    if (!next && pending) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <FormDialogContent size="lg" className="sm:max-w-xl" showCloseButton={!pending}>
        <AiSummaryTasksForm
          key={opening}
          wsId={wsId}
          idPrefix={idPrefix}
          seeds={view.seeds}
          initialProjectId={initialProjectId}
          copy={view.copy}
          itemNotes={view.itemNotes}
          pending={pending}
          onCancel={() => changeOpen(false)}
          onConfirm={onConfirm}
        />
      </FormDialogContent>
    </Dialog>
  );
}
