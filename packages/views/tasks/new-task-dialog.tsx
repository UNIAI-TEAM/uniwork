"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { paths } from "@uniwork/core/paths";
import {
  useCreateTask,
  useProjects,
  useTaskProperties,
  useTaskLabels,
  useTaskStatuses,
  useTasks,
  useUploadWorkspaceAttachment,
  useDeleteAttachment,
  type CreateTaskBody,
} from "@uniwork/core/tasks";
import {
  useCreateTaskDraftStore,
  type CreateTaskDraft,
  type CreateTaskSettings,
} from "@uniwork/core/tasks/stores/create-task-draft-store";
import { TASK_PRIORITIES, TASK_STATUSES } from "@uniwork/core/types";
import { createSafeId } from "@uniwork/core/utils";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { DateField } from "../common/date-field";
import { ContentEditor } from "../editor";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useOptionalNavigation } from "../navigation";
import { toastApiError } from "../toast-api-error";
import { AssigneePicker } from "./pickers/assignee-picker";
import { LabelPicker } from "./pickers/label-picker";
import { useWorkspaceAssigneeOptions } from "./pickers/member-options";
import { CreateTaskCustomProperties } from "./create-task-custom-properties";

type NewTaskDialogProps = {
  workspaceId: string;
  defaults?: Partial<CreateTaskBody>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
};

function draftFromDefaults(
  defaults?: Partial<CreateTaskBody>,
  settings?: CreateTaskSettings | null,
): CreateTaskDraft {
  const hasDefaultAssignee = defaults != null && "assignee_id" in defaults;
  const hasDefaultProject = defaults != null && "project_id" in defaults;
  const hasDefaultStage = defaults != null && "stage" in defaults;
  const assigneeId = hasDefaultAssignee ? defaults.assignee_id ?? undefined : settings?.assigneeId;
  return {
    title: defaults?.title ?? "",
    description: defaults?.description,
    status: defaults?.status ?? settings?.status ?? "todo",
    priority: defaults?.priority ?? settings?.priority ?? "none",
    assigneeId,
    assigneeKind:
      hasDefaultAssignee && defaults?.assignee_kind === "agent"
        ? "agent"
        : hasDefaultAssignee && assigneeId
          ? "human"
          : settings?.assigneeKind,
    projectId: hasDefaultProject ? defaults?.project_id ?? undefined : settings?.projectId,
    parentTaskId: defaults?.parent_task_id ?? undefined,
    stage: hasDefaultStage
      ? defaults?.stage == null
        ? undefined
        : String(defaults.stage)
      : settings?.stage,
    startDate: defaults?.start_date ?? undefined,
    dueDate: defaults?.due_date ?? undefined,
    labelIds: defaults?.label_ids,
    properties: defaults?.properties,
    idempotencyKey: createSafeId(),
    version: 0,
  };
}

export function NewTaskDialog({
  workspaceId,
  defaults,
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: NewTaskDialogProps) {
  const { t } = useTranslation();
  const workspaceContext = useOptionalWorkspace();
  const navigation = useOptionalNavigation();
  const create = useCreateTask(workspaceId);
  const uploadAttachment = useUploadWorkspaceAttachment(workspaceId);
  const deleteAttachment = useDeleteAttachment(workspaceId, "");
  const { data: projectList } = useProjects(workspaceId);
  const { data: labelList } = useTaskLabels(workspaceId);
  const { data: statusList } = useTaskStatuses(workspaceId);
  const { data: taskList } = useTasks(workspaceId);
  const { data: propertyList } = useTaskProperties(workspaceId);
  const assignees = useWorkspaceAssigneeOptions(workspaceId);
  const draftFor = useCreateTaskDraftStore((state) => state.draftFor);
  const persistDraft = useCreateTaskDraftStore((state) => state.setDraft);
  const settingsFor = useCreateTaskDraftStore((state) => state.settingsFor);
  const persistSettings = useCreateTaskDraftStore((state) => state.setSettings);
  const clearDraft = useCreateTaskDraftStore((state) => state.clearDraft);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [draft, setDraftState] = useState<CreateTaskDraft>(() =>
    draftFromDefaults(defaults, settingsFor(workspaceId)),
  );
  const draftRef = useRef(draft);
  const uploadInFlightRef = useRef(false);
  const [createAnother, setCreateAnother] = useState(false);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  useEffect(() => {
    if (!open) return;
    const next = draftFor(workspaceId) ?? draftFromDefaults(defaults, settingsFor(workspaceId));
    draftRef.current = next;
    setDraftState(next);
  }, [open, workspaceId, defaults, draftFor, settingsFor]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const updateDraft = (patch: Partial<CreateTaskDraft>) => {
    const current = draftRef.current;
    const next = { ...current, ...patch, version: (current.version ?? 0) + 1 };
    draftRef.current = next;
    setDraftState(next);
    persistDraft(workspaceId, next);
  };

  const statusItems = useMemo(
    () =>
      statusList?.statuses.length
        ? statusList.statuses.map((status) => ({ value: status.key, label: status.name }))
        : TASK_STATUSES.map((status) => ({ value: status, label: t(`tasks.status_${status}`) })),
    [statusList, t],
  );
  const priorityItems = useMemo(
    () => TASK_PRIORITIES.map((priority) => ({ value: priority, label: t(`tasks.priority_${priority}`) })),
    [t],
  );
  const projectItems = useMemo(
    () => [
      { value: "__none__", label: t("tasks.create.project_none") },
      ...(projectList?.projects ?? []).map((project) => ({ value: project.id, label: project.title })),
    ],
    [projectList, t],
  );
  const parentItems = useMemo(
    () => [
      { value: "__none__", label: t("tasks.create.parent_none") },
      ...(taskList ?? []).map((task) => ({
        value: task.id,
        label: `${task.identifier || task.id} ${task.title}`,
      })),
    ],
    [taskList, t],
  );
  const assignee = draft.assigneeId
    ? { id: draft.assigneeId, kind: draft.assigneeKind ?? ("human" as const) }
    : null;
  const assigneeLabel = assignee
    ? assignees.options.find((option) => option.id === assignee.id && option.kind === assignee.kind)?.name ??
      t("tasks.assignee")
    : t("tasks.unassigned");

  const submit = () => {
    if (create.isPending || uploadInFlightRef.current) return;
    const title = draft.title.trim();
    if (!title) return;
    const submitted = { ...draft, title };
    void create
      .mutateAsync({
        title,
        description: draft.description?.trim() || undefined,
        status: draft.status,
        priority: draft.priority,
        assignee_id: draft.assigneeId || null,
        assignee_kind: draft.assigneeId ? draft.assigneeKind ?? "human" : undefined,
        project_id: draft.projectId || null,
        parent_task_id: draft.parentTaskId || null,
        stage: draft.stage ? Number(draft.stage) : null,
        start_date: draft.startDate || null,
        due_date: draft.dueDate || null,
        label_ids: draft.labelIds,
        attachment_ids: draft.attachments?.map((attachment) => attachment.id),
        properties: draft.properties,
        idempotencyKey: draft.idempotencyKey,
      })
      .then((task) => {
        const latest = draftRef.current;
        const submittedIsStillCurrent =
          latest.idempotencyKey === submitted.idempotencyKey &&
          (latest.version ?? 0) === (submitted.version ?? 0);
        clearDraft(workspaceId, submitted.idempotencyKey, submitted.version ?? 0);
        const savedSettings: CreateTaskSettings = {
          status: submitted.status,
          priority: submitted.priority,
          assigneeId: submitted.assigneeId,
          assigneeKind: submitted.assigneeKind,
          projectId: submitted.projectId,
          stage: submitted.stage,
        };
        persistSettings(workspaceId, savedSettings);
        const taskPath = workspaceContext
          ? paths
              .workspace(
                workspaceContext.workspace.organization_slug,
                workspaceContext.workspace.slug,
              )
              .task(task.id)
          : null;
        toast.success(t("tasks.create.success", { identifier: task.identifier }), {
          ...(taskPath && navigation
            ? {
                action: {
                  label: t("tasks.create.view"),
                  onClick: () => navigation.push(taskPath),
                },
              }
            : {}),
        });
        if (!submittedIsStillCurrent) return;
        if (createAnother) {
          const next = draftFromDefaults(undefined, savedSettings);
          draftRef.current = next;
          setDraftState(next);
          return;
        }
        const next = draftFromDefaults(undefined, savedSettings);
        draftRef.current = next;
        setDraftState(next);
        setOpen(false);
      })
      .catch((error: unknown) => toastApiError(error, t("tasks.create.error")));
  };

  const uploadFile = (file: File) => {
    setFailedFile(null);
    uploadInFlightRef.current = true;
    void uploadAttachment.mutateAsync(file).then((attachment) => {
      updateDraft({ attachments: [...(draftRef.current.attachments ?? []), attachment] });
    }).catch(() => setFailedFile(file)).finally(() => {
      uploadInFlightRef.current = false;
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger ? <DialogTrigger render={<Button size="sm">{t("tasks.new")}</Button>} /> : null}
      <DialogContent className="max-h-[min(90vh,44rem)] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>{t("tasks.new")}</DialogTitle>
        <DialogDescription className="sr-only">{t("tasks.create.description")}</DialogDescription>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="task-title">{t("tasks.taskTitle")}</Label>
            <Input id="task-title" value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} required maxLength={200} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>{t("tasks.description")}</Label>
            <div className="min-h-24 rounded-lg border border-input px-2.5 py-2">
              <ContentEditor
                key={draft.idempotencyKey}
                defaultValue={draft.description ?? ""}
                ariaLabel={t("tasks.description")}
                placeholder={t("tasks.detail.description_placeholder")}
                onDocumentChange={(description) => updateDraft({ description })}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-status">{t("tasks.status")}</Label>
              <Select id="task-status" items={statusItems} value={draft.status ?? "todo"} onValueChange={(value) => updateDraft({ status: value ?? "todo" })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-priority">{t("tasks.priority")}</Label>
              <Select id="task-priority" items={priorityItems} value={draft.priority ?? "medium"} onValueChange={(value) => updateDraft({ priority: value ?? "medium" })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("tasks.assignee")}</Label>
              <AssigneePicker value={assignee} options={assignees.options} onChange={(value) => updateDraft({ assigneeId: value?.id, assigneeKind: value?.kind })} ariaLabel={t("tasks.assignee")} valueLabel={assigneeLabel} unassignedLabel={t("tasks.unassigned")} searchPlaceholder={t("tasks.assignee_search_placeholder")} noResultsLabel={t("tasks.assignee_no_results")} triggerClassName="w-full justify-between border border-input px-2.5">
                <span className="truncate">{assigneeLabel}</span>
              </AssigneePicker>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-project">{t("tasks.create.project")}</Label>
              <Select id="task-project" items={projectItems} value={draft.projectId || "__none__"} onValueChange={(value) => updateDraft({ projectId: !value || value === "__none__" ? undefined : value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-parent">{t("tasks.create.parent")}</Label>
              <Select
                id="task-parent"
                items={parentItems}
                value={draft.parentTaskId || "__none__"}
                onValueChange={(value) => updateDraft({ parentTaskId: !value || value === "__none__" ? undefined : value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-stage">{t("tasks.create.stage")}</Label>
              <Input
                id="task-stage"
                type="number"
                min={1}
                value={draft.stage ?? ""}
                onChange={(event) => updateDraft({ stage: event.target.value || undefined })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("tasks.detail.prop_labels")}</Label>
              <LabelPicker
                labels={labelList?.labels ?? []}
                selectedIds={new Set(draft.labelIds ?? [])}
                onToggle={(labelId, checked) => {
                  const selected = new Set(draft.labelIds ?? []);
                  if (checked) selected.add(labelId);
                  else selected.delete(labelId);
                  updateDraft({ labelIds: [...selected] });
                }}
                ariaLabel={t("tasks.detail.prop_labels")}
                valueLabel={t("tasks.create.labels_selected", { count: draft.labelIds?.length ?? 0 })}
                emptyLabel={t("tasks.table.labels_empty")}
                triggerClassName="w-full justify-start border border-input px-2.5"
              >
                <span>{t("tasks.create.labels_selected", { count: draft.labelIds?.length ?? 0 })}</span>
              </LabelPicker>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-start-date">{t("tasks.create.start_date")}</Label>
              <DateField id="task-start-date" value={draft.startDate ?? ""} onChange={(value) => updateDraft({ startDate: value || undefined })} modal={false} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-due-date">{t("tasks.dueDate")}</Label>
              <DateField id="task-due-date" value={draft.dueDate ?? ""} onChange={(value) => updateDraft({ dueDate: value || undefined })} modal={false} />
            </div>
          </div>
          {(propertyList?.properties.length ?? 0) > 0 ? (
            <fieldset className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
              <legend className="px-1 text-body font-medium">{t("tasks.create.custom_properties")}</legend>
              <CreateTaskCustomProperties
                properties={propertyList?.properties ?? []}
                values={draft.properties ?? {}}
                onChange={(propertyId, value) => {
                  const properties = { ...(draftRef.current.properties ?? {}) };
                  if (value === undefined) delete properties[propertyId];
                  else properties[propertyId] = value;
                  updateDraft({ properties });
                }}
              />
            </fieldset>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="task-attachments">{t("tasks.detail.attachments_section")}</Label>
            <Input
              id="task-attachments"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadFile(file);
                event.target.value = "";
              }}
            />
            {uploadAttachment.isPending ? (
              <p className="text-caption text-muted-foreground" aria-live="polite">
                {t("tasks.detail.attachments_uploading", { filename: uploadAttachment.variables?.name ?? "" })}
              </p>
            ) : null}
            {failedFile ? (
              <div className="flex items-center justify-between gap-2 text-body" role="alert">
                <span>{t("editor.upload.failed_label", { filename: failedFile.name })}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => uploadFile(failedFile)}>
                  {t("common.retry")}
                </Button>
              </div>
            ) : null}
            {(draft.attachments ?? []).map((attachment) => (
              <div key={attachment.id} className="flex items-center justify-between gap-2 text-body">
                <span className="truncate">{attachment.filename}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    updateDraft({ attachments: draftRef.current.attachments?.filter((item) => item.id !== attachment.id) });
                    void deleteAttachment.mutateAsync(attachment.id);
                  }}
                >
                  {t("editor.upload.remove")}
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <label className="flex items-center gap-2 text-body">
              <Checkbox checked={createAnother} onCheckedChange={setCreateAnother} />
              {t("tasks.create.create_another")}
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
              <Button type="submit" aria-disabled={create.isPending || uploadAttachment.isPending || !draft.title.trim()}>
                {create.isPending || uploadAttachment.isPending ? t("tasks.create.creating") : t("common.create")}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
