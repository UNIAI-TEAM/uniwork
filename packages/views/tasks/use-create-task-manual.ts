"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { toUploadResult, type UploadResult } from "@uniwork/core/hooks/use-file-upload";
import { driveKeys } from "@uniwork/core/drive";
import { useQueryClient } from "@tanstack/react-query";
import { paths } from "@uniwork/core/paths";
import { useBillingPermissions } from "@uniwork/core/permissions";
import {
  useCreateTask,
  useProjects,
  useTaskProperties,
  useTaskLabels,
  useTasks,
  useUploadWorkspaceAttachment,
  type CreateTaskBody,
} from "@uniwork/core/tasks";
import {
  useCreateTaskDraftStore,
  type CreateTaskDraft,
  type CreateTaskSettings,
} from "@uniwork/core/tasks/stores/create-task-draft-store";
import { editorAttachmentPurpose } from "@uniwork/core/constants/upload";
import { contentReferencesAttachment } from "@uniwork/core/types/attachment-url";
import { createSafeId } from "@uniwork/core/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useOptionalNavigation } from "../navigation";
import { toastCreateTaskError } from "./create-task-error-toast";
import { resolveCreateTaskDriveError } from "./create-task-drive-errors";
import { propertyFieldKey, type OverflowFieldKey } from "./create-task-manual-overflow";
import { useWorkspaceAssigneeOptions } from "./pickers/member-options";

export function draftFromDefaults(
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
    startAt: defaults?.start_at ?? undefined,
    dueAt: defaults?.due_at ?? undefined,
    labelIds: defaults?.label_ids,
    properties: defaults?.properties,
    idempotencyKey: createSafeId(),
    version: 0,
  };
}

export function initialRevealed(draft: CreateTaskDraft): Set<OverflowFieldKey> {
  const next = new Set<OverflowFieldKey>();
  if (draft.parentTaskId) next.add("parent");
  if (draft.stage) next.add("stage");
  if (draft.startDate) next.add("start_date");
  if (draft.dueDate) next.add("due_date");
  for (const propertyId of Object.keys(draft.properties ?? {})) {
    next.add(propertyFieldKey(propertyId));
  }
  return next;
}

export function draftWithDefaults(
  draft: CreateTaskDraft,
  defaults?: Partial<CreateTaskBody>,
): CreateTaskDraft {
  if (!defaults) return draft;
  const next = { ...draft };
  if ("title" in defaults) next.title = defaults.title ?? "";
  if ("description" in defaults) next.description = defaults.description;
  if ("status" in defaults) next.status = defaults.status ?? "todo";
  if ("priority" in defaults) next.priority = defaults.priority ?? "none";
  if ("assignee_id" in defaults) {
    next.assigneeId = defaults.assignee_id ?? undefined;
    next.assigneeKind = defaults.assignee_id
      ? defaults.assignee_kind === "agent"
        ? "agent"
        : "human"
      : undefined;
  }
  if ("project_id" in defaults) next.projectId = defaults.project_id ?? undefined;
  if ("parent_task_id" in defaults) {
    next.parentTaskId = defaults.parent_task_id ?? undefined;
  }
  if ("stage" in defaults) {
    next.stage = defaults.stage == null ? undefined : String(defaults.stage);
  }
  if ("start_date" in defaults) next.startDate = defaults.start_date ?? undefined;
  if ("due_date" in defaults) next.dueDate = defaults.due_date ?? undefined;
  if ("start_at" in defaults) next.startAt = defaults.start_at ?? undefined;
  if ("due_at" in defaults) next.dueAt = defaults.due_at ?? undefined;
  if ("label_ids" in defaults) next.labelIds = defaults.label_ids;
  if ("properties" in defaults) next.properties = defaults.properties;
  return next;
}

/**
 * Sends the composer's task through another command than POST /tasks: a
 * meeting's convert, which links its item to the task in one transaction.
 * The composer then keeps no draft and no last-used settings of its own, and
 * the submitter says the outcome; a refusal it has no words for
 * (errorText → undefined) gets the composer's own toast.
 */
export type CreateTaskSubmitter = {
  /** Resolves once the task exists, rejects with the refusal. */
  submit: (body: CreateTaskBody) => Promise<void>;
  pending: boolean;
  errorText?: (error: unknown) => string | undefined;
};

export function useCreateTaskManualState({
  workspaceId,
  defaults,
  carry,
  onClose,
  createAnother,
  submitter,
}: {
  workspaceId: string;
  defaults?: Partial<CreateTaskBody>;
  carry?: Record<string, unknown> | null;
  onClose: (reason?: "saved" | "submitted") => void;
  createAnother: boolean;
  submitter?: CreateTaskSubmitter;
}) {
  const { t } = useTranslation();
  const workspaceContext = useOptionalWorkspace();
  const navigation = useOptionalNavigation();
  const create = useCreateTask(workspaceId);
  const queryClient = useQueryClient();
  const uploadAttachment = useUploadWorkspaceAttachment(workspaceId);
  const { data: projectList } = useProjects(workspaceId);
  const { data: labelList } = useTaskLabels(workspaceId);
  const { data: taskList } = useTasks(workspaceId);
  const { data: propertyList } = useTaskProperties(workspaceId);
  const assignees = useWorkspaceAssigneeOptions(workspaceId);
  const draftFor = useCreateTaskDraftStore((state) => state.draftFor);
  const persistDraft = useCreateTaskDraftStore((state) => state.setDraft);
  const persistSavedDraft = useCreateTaskDraftStore((state) => state.saveDraft);
  const settingsFor = useCreateTaskDraftStore((state) => state.settingsFor);
  const persistSettings = useCreateTaskDraftStore((state) => state.setSettings);
  const clearDraft = useCreateTaskDraftStore((state) => state.clearDraft);
  const orgId = workspaceContext?.workspace.organization_id ?? "";
  const { canView: canViewBillingDecision } = useBillingPermissions(orgId);
  // A submitter's task starts from its defaults alone: the person's own draft stays theirs.
  const ownDrafts = !submitter;
  const initialDraft = () => {
    const stored = ownDrafts ? draftFor(workspaceId) : null;
    return stored
      ? draftWithDefaults(stored, defaults)
      : draftFromDefaults(defaults, ownDrafts ? settingsFor(workspaceId) : null);
  };
  const [draft, setDraftState] = useState<CreateTaskDraft>(initialDraft);
  const draftRef = useRef(draft);
  const uploadCountRef = useRef(0);
  const carryAppliedRef = useRef<Record<string, unknown> | null>(null);
  const [uploadCount, setUploadCount] = useState(0);
  const [revealed, setRevealed] = useState<Set<OverflowFieldKey>>(() =>
    initialRevealed(initialDraft()),
  );

  useEffect(() => {
    const stored = ownDrafts ? draftFor(workspaceId) : null;
    const next = stored
      ? draftWithDefaults(stored, defaults)
      : draftFromDefaults(defaults, ownDrafts ? settingsFor(workspaceId) : null);
    draftRef.current = next;
    setDraftState(next);
    setRevealed(initialRevealed(next));
  }, [workspaceId, defaults, draftFor, settingsFor, ownDrafts]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!carry || carry === carryAppliedRef.current) return;
    carryAppliedRef.current = carry;
    const patch: Partial<CreateTaskDraft> = {};
    if (typeof carry.project_id === "string") patch.projectId = carry.project_id;
    if (typeof carry.title === "string") patch.title = carry.title;
    if (typeof carry.description === "string") patch.description = carry.description;
    if (Object.keys(patch).length === 0) return;
    const current = draftRef.current;
    const next = { ...current, ...patch, version: (current.version ?? 0) + 1 };
    draftRef.current = next;
    setDraftState(next);
    if (ownDrafts) persistDraft(workspaceId, next);
  }, [carry, persistDraft, workspaceId, ownDrafts]);

  const updateDraft = (patch: Partial<CreateTaskDraft>) => {
    const current = draftRef.current;
    const next = { ...current, ...patch, version: (current.version ?? 0) + 1 };
    draftRef.current = next;
    setDraftState(next);
    if (ownDrafts) persistDraft(workspaceId, next);
  };

  const projectItems = useMemo(
    () => (projectList?.projects ?? []).map((project) => ({ value: project.id, label: project.title })),
    [projectList],
  );
  const parentItems = useMemo(
    () =>
      (taskList ?? []).map((task) => ({
        value: task.id,
        label: `${task.identifier || task.id} ${task.title}`,
      })),
    [taskList],
  );
  const maxSiblingStage = useMemo(
    () =>
      (taskList ?? []).reduce((maximum, task) => {
        if (!draft.parentTaskId || task.parent_task_id !== draft.parentTaskId) return maximum;
        const stage = typeof task.stage === "number" ? task.stage : Number(task.stage);
        return Number.isSafeInteger(stage) && stage > maximum ? stage : maximum;
      }, 0),
    [draft.parentTaskId, taskList],
  );

  const pending = submitter ? submitter.pending : create.isPending;
  const submit = () => {
    if (pending || uploadCountRef.current > 0) return;
    const currentDraft = draftRef.current;
    const title = currentDraft.title.trim();
    if (!title) return;
    // The project remembered from the last task may have been deleted since: the server would
    // answer 404 and the picker already shows "no project", so send what it shows. Only the
    // remembered one: a project a surface passes in may simply be newer than the cached list.
    const projectGone =
      Boolean(currentDraft.projectId) &&
      currentDraft.projectId === (ownDrafts ? settingsFor(workspaceId)?.projectId : undefined) &&
      projectList !== undefined &&
      !projectList.projects.some((project) => project.id === currentDraft.projectId);
    const submitted = { ...currentDraft, title, ...(projectGone ? { projectId: undefined } : {}) };
    const body: CreateTaskBody = {
      title,
      description: currentDraft.description?.trim() || undefined,
      status: currentDraft.status,
      priority: currentDraft.priority,
      assignee_id: currentDraft.assigneeId || null,
      assignee_kind: currentDraft.assigneeId ? currentDraft.assigneeKind ?? "human" : undefined,
      project_id: submitted.projectId || null,
      parent_task_id: currentDraft.parentTaskId || null,
      stage: (() => {
        if (!currentDraft.stage) return null;
        const parsed = Number(currentDraft.stage);
        return Number.isFinite(parsed) ? parsed : null;
      })(),
      start_date: currentDraft.startDate || null,
      due_date: currentDraft.dueDate || null,
      start_at: currentDraft.startAt || null,
      due_at: currentDraft.dueAt || null,
      label_ids: currentDraft.labelIds,
      attachment_ids: currentDraft.attachments
        ?.filter((attachment) =>
          contentReferencesAttachment(currentDraft.description ?? "", attachment),
        )
        .map((attachment) => attachment.id),
      drive_files: currentDraft.driveFiles?.length
        ? currentDraft.driveFiles.map((df) => ({
            connection_id: df.connectionId,
            external_file_id: df.externalFileId,
          }))
        : undefined,
      properties: currentDraft.properties,
    };
    if (submitter) {
      // The submitter moves on (next defaults) or closes; a refusal keeps the edits.
      submitter.submit(body).catch((error: unknown) => {
        const own = submitter.errorText?.(error);
        if (own) toast.error(own);
        else reportCreateError(error);
      });
      return;
    }
    void create
      .mutateAsync({ ...body, idempotencyKey: currentDraft.idempotencyKey })
      .then((task) => {
        if (submitted.driveFiles?.length) {
          void queryClient.invalidateQueries({
            queryKey: driveKeys.workspace(workspaceId),
          });
        }
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
        const next = draftFromDefaults(undefined, savedSettings);
        draftRef.current = next;
        setDraftState(next);
        setRevealed(initialRevealed(next));
        if (!createAnother) onClose("submitted");
      })
      .catch(reportCreateError);
  };

  const reportCreateError = (error: unknown) => {
    const driveResolution = resolveCreateTaskDriveError(
      error,
      draftRef.current.driveFiles,
      t,
    );
    if (driveResolution) {
      updateDraft({ driveFiles: driveResolution.updatedDriveFiles });
      toast.error(driveResolution.toastMessage);
      return;
    }

    toastCreateTaskError(
      error,
      {
        fallback: t("tasks.create.error"),
        duplicateTitle: t("tasks.create.duplicate"),
        viewExisting: t("tasks.create.view"),
        quotaExceeded: t("tasks.create.quota_exceeded"),
        quotaContactAdmin: t("tasks.create.quota_contact_admin"),
        viewBilling: t("tasks.create.view_billing"),
        inFlight: t("tasks.create.in_flight"),
      },
      {
        onViewTask:
          navigation && workspaceContext
            ? (taskId) => {
                navigation.push(
                  paths
                    .workspace(
                      workspaceContext.workspace.organization_slug,
                      workspaceContext.workspace.slug,
                    )
                    .task(taskId),
                );
              }
            : undefined,
        canViewBilling: canViewBillingDecision.allowed,
        onViewBilling:
          navigation && workspaceContext
            ? () =>
                navigation.push(
                  paths
                    .workspace(
                      workspaceContext.workspace.organization_slug,
                      workspaceContext.workspace.slug,
                    )
                    .settings(),
                )
            : undefined,
      },
    );
  };

  const uploadFile = async (file: File, _uploadId: string): Promise<UploadResult | null> => {
    uploadCountRef.current += 1;
    setUploadCount(uploadCountRef.current);
    try {
      const attachment = await uploadAttachment.mutateAsync({
        file,
        purpose: editorAttachmentPurpose(file),
      });
      const attachments = draftRef.current.attachments ?? [];
      if (!attachments.some((item) => item.id === attachment.id)) {
        updateDraft({ attachments: [...attachments, attachment] });
      }
      return toUploadResult(attachment);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      toast.error(t("editor.upload.failed", { filename: file.name, reason }));
      return null;
    } finally {
      uploadCountRef.current = Math.max(0, uploadCountRef.current - 1);
      setUploadCount(uploadCountRef.current);
    }
  };

  const setProperty = (propertyId: string, value: unknown | undefined) => {
    const properties = { ...(draftRef.current.properties ?? {}) };
    if (value === undefined) delete properties[propertyId];
    else properties[propertyId] = value;
    updateDraft({ properties });
  };

  const saveDraft = () => {
    if (create.isPending || uploadCountRef.current > 0) return;
    persistSavedDraft(workspaceId, draftRef.current);
    onClose("saved");
  };

  return {
    t,
    draft,
    draftRef,
    updateDraft,
    revealed,
    reveal: (key: OverflowFieldKey) => setRevealed((current) => new Set([...current, key])),
    unreveal: (key: OverflowFieldKey) =>
      setRevealed((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      }),
    projectItems,
    parentItems,
    maxSiblingStage,
    labelList,
    propertyList,
    assignees,
    assignee: draft.assigneeId
      ? { id: draft.assigneeId, kind: draft.assigneeKind ?? ("human" as const) }
      : null,
    assigneeLabel: (() => {
      const ref = draft.assigneeId
        ? { id: draft.assigneeId, kind: draft.assigneeKind ?? ("human" as const) }
        : null;
      if (!ref) return t("tasks.unassigned");
      return (
        assignees.options.find((option) => option.id === ref.id && option.kind === ref.kind)?.name ??
        t("tasks.assignee")
      );
    })(),
    workspaceName: workspaceContext?.workspace.name ?? t("tasks.new"),
    submit,
    saveDraft,
    uploadFile,
    setProperty,
    create,
    uploadAttachment,
    uploading: uploadCount > 0,
    busy: pending || uploadCount > 0,
  };
}
