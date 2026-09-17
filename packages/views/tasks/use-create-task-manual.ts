"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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

export function useCreateTaskManualState({
  workspaceId,
  defaults,
  carry,
  onClose,
}: {
  workspaceId: string;
  defaults?: Partial<CreateTaskBody>;
  carry?: Record<string, unknown> | null;
  onClose: () => void;
}) {
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
  const orgId = workspaceContext?.workspace.organization_id ?? "";
  const { canView: canViewBillingDecision } = useBillingPermissions(orgId);
  const [draft, setDraftState] = useState<CreateTaskDraft>(() =>
    draftFromDefaults(defaults, settingsFor(workspaceId)),
  );
  const draftRef = useRef(draft);
  const uploadInFlightRef = useRef(false);
  const carryAppliedRef = useRef<Record<string, unknown> | null>(null);
  const [createAnother, setCreateAnother] = useState(false);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const [revealed, setRevealed] = useState<Set<OverflowFieldKey>>(() =>
    initialRevealed(draftFromDefaults(defaults, settingsFor(workspaceId))),
  );

  useEffect(() => {
    const next = draftFor(workspaceId) ?? draftFromDefaults(defaults, settingsFor(workspaceId));
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
          stage: (() => {
            if (!draft.stage) return null;
            const parsed = Number(draft.stage);
            return Number.isFinite(parsed) ? parsed : null;
          })(),
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

  const uploadFile = (file: File) => {
    setFailedFile(null);
    uploadInFlightRef.current = true;
    void uploadAttachment
      .mutateAsync(file)
      .then((attachment) => {
        updateDraft({ attachments: [...(draftRef.current.attachments ?? []), attachment] });
      })
      .catch(() => setFailedFile(file))
      .finally(() => {
        uploadInFlightRef.current = false;
      });
  };

  const removeAttachment = (attachmentId: string) => {
    updateDraft({
      attachments: draftRef.current.attachments?.filter((item) => item.id !== attachmentId),
    });
    void deleteAttachment.mutateAsync(attachmentId);
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
    createAnother,
    setCreateAnother,
    failedFile,
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
    removeAttachment,
    setProperty,
    create,
    uploadAttachment,
    busy: create.isPending || uploadAttachment.isPending,
  };
}
