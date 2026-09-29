"use client";

import { useRef, useState } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { PROJECT_PRIORITY_ORDER } from "@uniwork/core/projects/config";
import { useCreateProject } from "@uniwork/core/tasks";
import type { ProjectPriority, ProjectStatus } from "@uniwork/core/types/project";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { ContentEditor } from "../editor";
import { manualDialogContentClass } from "../tasks/create-task-dialog-classes";
import type { AssigneeRef } from "../tasks/pickers/assignee-picker";
import { CreateTaskAssigneeField } from "../tasks/pickers/create-task-property-fields";
import { PriorityPicker } from "../tasks/pickers/priority-picker";
import { useWorkspaceAssigneeOptions } from "../tasks/pickers/member-options";
import {
  CreateProjectDateFields,
  CreateProjectIconField,
  CreateProjectStatusField,
} from "./create-project-fields";
import { leadRefToProjectBody } from "./project-row-metrics";

const TITLE_MAX_LENGTH = 200;

type ProjectDraft = {
  icon?: string;
  title: string;
  description: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  lead: AssigneeRef | null;
  startDate: string;
  dueDate: string;
};

const EMPTY_DRAFT: ProjectDraft = {
  title: "",
  description: "",
  status: "planned",
  priority: "none",
  lead: null,
  startDate: "",
  dueDate: "",
};

/**
 * Create-project composer. The draft lives here, above the Dialog, so closing
 * the dialog keeps what was typed; only a successful create clears it.
 */
export function CreateProjectDialog({
  workspaceId,
  workspaceName,
  open,
  onOpenChange,
  onCreated,
}: {
  workspaceId: string;
  workspaceName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const createProject = useCreateProject(workspaceId);
  const assignees = useWorkspaceAssigneeOptions(workspaceId);
  const [draft, setDraft] = useState<ProjectDraft>(EMPTY_DRAFT);
  const [isExpanded, setIsExpanded] = useState(false);
  // A ref, not isPending: two Enter presses land before the mutation's state re-renders.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const update = (patch: Partial<ProjectDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));
  const canSubmit = draft.title.trim().length > 0 && !submitting;

  const lead = draft.lead
    ? assignees.options.find((o) => o.id === draft.lead?.id && o.kind === draft.lead?.kind)
    : undefined;

  const submit = async () => {
    const title = draft.title.trim();
    if (!title || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const created = await createProject.mutateAsync({
        title,
        description: draft.description.trim() || undefined,
        icon: draft.icon ?? null,
        status: draft.status,
        priority: draft.priority,
        ...leadRefToProjectBody(draft.lead),
        start_date: draft.startDate || null,
        due_date: draft.dueDate || null,
      });
      setDraft(EMPTY_DRAFT);
      onOpenChange(false);
      toast.success(t("projects.create_dialog.toast_created"));
      if (created?.id) onCreated(created.id);
    } catch (err) {
      toast.error(apiErrorMessage(err) ?? t("projects.create_dialog.toast_failed"));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={manualDialogContentClass(isExpanded)}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-3 pb-2">
            <div className="min-w-0">
              <DialogTitle className="truncate text-body font-medium">
                {workspaceName ? (
                  <>
                    <span className="text-muted-foreground">{workspaceName}</span>
                    <span className="mx-1.5 text-muted-foreground" aria-hidden>
                      ›
                    </span>
                  </>
                ) : null}
                {t("projects.create_dialog.title")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t("projects.create_dialog.description")}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={isExpanded ? t("tasks.create.collapse") : t("tasks.create.expand")}
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? (
                  <Minimize2 className="size-4" aria-hidden />
                ) : (
                  <Maximize2 className="size-4" aria-hidden />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("common.close")}
                onClick={() => onOpenChange(false)}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
          </div>

          <div className="shrink-0 px-5 pb-2">
            <CreateProjectIconField value={draft.icon} onChange={(icon) => update({ icon })} />
            <Input
              aria-label={t("projects.create_dialog.title_placeholder")}
              value={draft.title}
              onChange={(event) => update({ title: event.target.value })}
              placeholder={t("projects.create_dialog.title_placeholder")}
              required
              maxLength={TITLE_MAX_LENGTH}
              autoFocus
              className="h-auto rounded-none border-0 bg-transparent px-0 py-0 text-title font-semibold shadow-none placeholder:font-semibold focus-visible:border-transparent focus-visible:ring-0 md:text-title dark:bg-transparent"
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5">
            <div className="min-h-20 flex-1">
              <ContentEditor
                defaultValue={draft.description}
                ariaLabel={t("projects.detail.description_placeholder")}
                placeholder={t("projects.detail.description_placeholder")}
                onDocumentChange={(description) => update({ description })}
                onSubmit={() => void submit()}
              />
            </div>
            <p className="mt-1 shrink-0 text-caption text-muted-foreground">
              {t("projects.detail.description_hint")}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 py-2">
            <CreateProjectStatusField
              value={draft.status}
              onChange={(status) => update({ status })}
            />
            <PriorityPicker
              appearance="pill"
              order={PROJECT_PRIORITY_ORDER}
              value={draft.priority}
              ariaLabel={t("projects.table.priority")}
              onChange={(priority) => update({ priority })}
            />
            <CreateTaskAssigneeField
              value={draft.lead}
              options={assignees.options}
              onChange={(value) => update({ lead: value })}
              ariaLabel={t("projects.table.lead")}
              valueLabel={lead?.name ?? t("projects.table.lead")}
              unassignedLabel={t("projects.lead.no_lead")}
              searchPlaceholder={t("projects.lead.assign_placeholder")}
              noResultsLabel={t("projects.lead.no_results")}
            />
            <CreateProjectDateFields
              startDate={draft.startDate}
              dueDate={draft.dueDate}
              onStartDateChange={(startDate) => update({ startDate })}
              onDueDateChange={(dueDate) => update({ dueDate })}
            />
          </div>

          <div className="flex shrink-0 items-center justify-end border-t border-surface-border/50 px-4 py-3">
            <Button
              type="submit"
              size="sm"
              aria-disabled={!canSubmit || undefined}
              aria-busy={submitting || undefined}
            >
              {submitting ? t("tasks.create.creating") : t("projects.create_dialog.confirm")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
