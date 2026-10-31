"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAiCapabilities, useChatTaskDraft } from "@uniwork/core/ai";
import { titleFromMessageBody } from "@uniwork/core/chat/message-links";
import { useCreateTaskFromChatMessage } from "@uniwork/core/chat";
import type { CreateTaskBody } from "@uniwork/core/tasks";
import type { TaskPriority } from "@uniwork/core/types";
import { CreateTaskDialog } from "../tasks/create-task-dialog";
import type { CreateTaskSubmitter } from "../tasks/use-create-task-manual";
import { chatErrorMessage } from "./chat-error-message";
import {
  anchorSourceMessage,
  descriptionFromSourceMessages,
  type CreateTaskSourceMessage,
} from "./create-task-from-message-quote";
import { useChatTaskNav } from "./use-chat-task-nav";

const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 4000;

function asPriority(value: string): TaskPriority {
  switch (value) {
    case "none":
    case "low":
    case "medium":
    case "high":
    case "urgent":
      return value;
    default:
      return "none";
  }
}

function defaultsFromSources(
  sources: CreateTaskSourceMessage[],
  fallbackBody: string,
): Partial<CreateTaskBody> {
  const anchor = anchorSourceMessage(sources);
  return {
    title: titleFromMessageBody(anchor?.body ?? fallbackBody).slice(0, TITLE_MAX_LENGTH),
    description: descriptionFromSourceMessages(sources).slice(0, DESCRIPTION_MAX_LENGTH) || undefined,
    assignee_id: null,
    project_id: null,
  };
}

/**
 * Creates a task from one or more chat messages through the same composer as
 * "Tạo thủ công" — title, description, property pills, dates — then posts via
 * the chat create-from-message command so the message stays linked.
 */
export function CreateTaskFromMessageDialog({
  open,
  onOpenChange,
  workspaceId,
  messageId,
  messageBody,
  senderId,
  sentAt,
  sourceMessages,
  allowSyncThread = false,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  messageId: string;
  messageBody: string;
  senderId?: string;
  sentAt?: number;
  roomTitle?: string;
  /** When set (multi-select), overrides the single message props for draft. */
  sourceMessages?: CreateTaskSourceMessage[];
  /** Kept for callers; the manual composer has no sync-thread control. */
  allowSyncThread?: boolean;
  onCreated?: (taskId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const createTask = useCreateTaskFromChatMessage(workspaceId);
  const draftTask = useChatTaskDraft(workspaceId);
  const { data: caps } = useAiCapabilities(workspaceId, open);
  const { openTaskAction } = useChatTaskNav();

  const sources = useMemo<CreateTaskSourceMessage[]>(() => {
    if (sourceMessages && sourceMessages.length > 0) return sourceMessages;
    if (!messageId) return [];
    return [{ id: messageId, body: messageBody, senderId, sentAt }];
  }, [messageBody, messageId, senderId, sentAt, sourceMessages]);

  const linkedMessageId = useMemo(
    () => anchorSourceMessage(sources)?.id ?? messageId,
    [messageId, sources],
  );
  const sourceKey = useMemo(() => sources.map((message) => message.id).join(","), [sources]);

  const [defaults, setDefaults] = useState<Partial<CreateTaskBody>>(() =>
    defaultsFromSources(sources, messageBody),
  );
  const autoDraftKeyRef = useRef<string | null>(null);
  const syncThreadRef = useRef(false);

  useEffect(() => {
    if (!open) {
      autoDraftKeyRef.current = null;
      syncThreadRef.current = false;
      return;
    }
    syncThreadRef.current = false;
    setDefaults(defaultsFromSources(sources, messageBody));
    // Reset once per open selection (ids), not on every parent re-render of the sources array.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sources content is keyed by sourceKey
  }, [messageBody, open, sourceKey]);

  const applyAiDraft = useCallback(() => {
    if (!caps?.enabled || sources.length === 0 || draftTask.isPending || createTask.isPending) {
      return;
    }
    void draftTask
      .mutateAsync({
        message_ids: sources.map((message) => message.id),
        locale: i18n.language.startsWith("vi") ? "vi" : "en",
      })
      .then((draft) => {
        if (!draft.title.trim()) {
          toast.error(t("chat.link.ai_draft_error"));
          return;
        }
        setDefaults((prev) => ({
          ...prev,
          title: draft.title.trim().slice(0, TITLE_MAX_LENGTH),
          description: draft.description.trim()
            ? draft.description.trim().slice(0, DESCRIPTION_MAX_LENGTH)
            : prev.description,
          priority: asPriority(draft.priority),
          due_date: /^\d{4}-\d{2}-\d{2}$/.test(draft.due_date.trim())
            ? draft.due_date.trim()
            : prev.due_date ?? null,
        }));
      })
      .catch((err: unknown) => {
        toast.error(chatErrorMessage(err, t, t("chat.link.ai_draft_error")));
      });
  }, [caps?.enabled, createTask.isPending, draftTask, i18n.language, sources, t]);

  // Fill the composer from AI once per open selection (one message or many).
  useEffect(() => {
    if (!open || sources.length < 1 || !caps?.enabled) return;
    const key = sourceKey;
    if (!key || autoDraftKeyRef.current === key) return;
    autoDraftKeyRef.current = key;
    applyAiDraft();
  }, [applyAiDraft, caps?.enabled, open, sourceKey, sources.length]);

  const heading =
    sources.length > 1
      ? t("chat.link.create_task_title_multi", { count: sources.length })
      : t("chat.link.create_task_title");

  const submitter: CreateTaskSubmitter = useMemo(
    () => ({
      pending: createTask.isPending || draftTask.isPending,
      errorText: (error) => chatErrorMessage(error, t, t("chat.link.create_error")),
      async submit(body: CreateTaskBody) {
        if (!linkedMessageId) {
          throw new Error("missing_message");
        }
        const task = await createTask.mutateAsync({
          messageId: linkedMessageId,
          title: body.title,
          description: body.description,
          status: body.status,
          project_id: body.project_id ?? undefined,
          assignee_id: body.assignee_id ?? undefined,
          assignee_kind: body.assignee_kind,
          start_date: body.start_date ?? undefined,
          due_date: body.due_date ?? undefined,
          label_ids: body.label_ids,
          priority: body.priority,
          sync_thread: allowSyncThread ? syncThreadRef.current : undefined,
        });
        if (!task?.id) {
          throw new Error("create_failed");
        }
        toast.success(t("chat.link.created_toast"), { action: openTaskAction(task.id) });
        onOpenChange(false);
        onCreated?.(task.id);
      },
    }),
    [
      allowSyncThread,
      createTask,
      draftTask.isPending,
      linkedMessageId,
      onCreated,
      onOpenChange,
      openTaskAction,
      t,
    ],
  );

  if (!open) return null;

  return (
    <CreateTaskDialog
      workspaceId={workspaceId}
      open={open}
      onOpenChange={onOpenChange}
      showTrigger={false}
      defaults={defaults}
      submitter={submitter}
      heading={heading}
    />
  );
}
