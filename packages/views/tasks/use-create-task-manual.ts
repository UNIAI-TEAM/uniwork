"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { toUploadResult, type UploadResult } from "@uniwork/core/hooks/use-file-upload";
import { paths } from "@uniwork/core/paths";
import { useBillingPermissions } from "@uniwork/core/permissions";
import {
  useCreateTask,
  useProjects,
  useTaskProperties,
  useTaskLabels,
  useTaskStatuses,
  useTasks,
  useUploadWorkspaceAttachment,
  type CreateTaskBody,
} from "@uniwork/core/tasks";
import {
  useCreateTaskDraftStore,
  type CreateTaskDraft,
  type CreateTaskSettings,
} from "@uniwork/core/tasks/stores/create-task-draft-store";
import { TASK_PRIORITIES, TASK_STATUSES } from "@uniwork/core/types";
import { contentReferencesAttachment } from "@uniwork/core/types/attachment-url";
import { createSafeId } from "@uniwork/core/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useOptionalNavigation } from "../navigation";
import { toastCreateTaskError } from "./create-task-error-toast";
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

export function useCreateTaskManualState({
  workspaceId,
  defaults,
  carry,
  onClose,
  createAnother,
}: {
  workspaceId: string;
  defaults?: Partial<CreateTaskBody>;
  carry?: Record<string, unknown> | null;
  onClose: () => void;
  createAnother: boolean;
}) {
  const { t } = useTranslation();
  const workspaceContext = useOptionalWorkspace();
  const navigation = useOptionalNavigation();
  const create = useCreateTask(workspaceId);
  const uploadAttachment = useUploadWorkspaceAttachment(workspaceId);
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
  const orgId = workspaceContext?.workspace.organization_id ?? "";
  const { canView: canViewBillingDecision } = useBillingPermissions(orgId);
  const initialDraft = () => {
    const stored = draftFor(workspaceId);
    return stored
      ? draftWithDefaults(stored, defaults)
      : draftFromDefaults(defaults, settingsFor(workspaceId));
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
    const stored = draftFor(workspaceId);
    const next = stored
      ? draftWithDefaults(stored, defaults)
      : draftFromDefaults(defaults, settingsFor(workspaceId));
    draftRef.current = next;
    setDraftState(next);
    setRevealed(initialRevealed(next));
  }, [workspaceId, defaults, draftFor, settingsFor]);

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
    persistDraft(workspaceId, next);
  }, [carry, persistDraft, workspaceId]);

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
        ? statusList.statuses.map((status) => ({
            value: status.key,
            label: status.name,
            category: status.category,
          }))
        : TASK_STATUSES.map((status) => ({
            value: status,
            label: t(`tasks.status_${status}`),
            category: status,
          })),
    [statusList, t],
  );
  const priorityItems = useMemo(
    () => TASK_PRIORITIES.map((priority) => ({ value: priority, label: t(`tasks.priority_${priority}`) })),
    [t],
  );
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

  const submit = () => {
    if (create.isPending || uploadCountRef.current > 0) return;
    const currentDraft = draftRef.current;
    const title = currentDraft.title.trim();
    if (!title) return;
    const submitted = { ...currentDraft, title };
    void create
      .mutateAsync({
        title,
        description: currentDraft.description?.trim() || undefined,
        status: currentDraft.status,
        priority: currentDraft.priority,
        assignee_id: currentDraft.assigneeId || null,
        assignee_kind: currentDraft.assigneeId ? currentDraft.assigneeKind ?? "human" : undefined,
        project_id: currentDraft.projectId || null,
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
        properties: currentDraft.properties,
        idempotencyKey: currentDraft.idempotencyKey,
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
        const next = draftFromDefaults(undefined, savedSettings);
        draftRef.current = next;
        setDraftState(next);
        setRevealed(initialRevealed(next));
        if (!createAnother) onClose();
      })
      .catch((error: unknown) => {
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
      });
  };

  const uploadFile = async (file: File, _uploadId: string): Promise<UploadResult | null> => {
    uploadCountRef.current += 1;
    setUploadCount(uploadCountRef.current);
    try {
      const attachment = await uploadAttachment.mutateAsync(file);
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
    statusItems,
    priorityItems,
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
    uploadFile,
    setProperty,
    create,
    uploadAttachment,
    uploading: uploadCount > 0,
    busy: create.isPending || uploadCount > 0,
  };
}
