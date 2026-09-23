"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { titleFromMessageBody } from "@uniwork/core/chat/message-links";
import { useCreateTaskFromChatMessage } from "@uniwork/core/chat";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import type { AssigneeRef } from "../tasks/pickers";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
import {
  ChatTaskAssigneeField,
  ChatTaskDueField,
  ChatTaskProjectField,
  chatTaskTitleInput,
} from "./chat-task-peek-fields";
import { chatErrorMessage } from "./chat-error-message";
import { ChatFormFooterNote, RequiredMark } from "./chat-form-parts";
import { useChatTaskNav } from "./use-chat-task-nav";

const TITLE_MAX_LENGTH = 200;

/** Create a task from a chat message: big title, property chips, one action. */
export function CreateTaskFromMessageDialog({
  open,
  onOpenChange,
  workspaceId,
  messageId,
  messageBody,
  allowSyncThread = false,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  messageId: string;
  messageBody: string;
  /** When true, show the “sync thread ↔ task comments” checkbox. */
  allowSyncThread?: boolean;
  onCreated?: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const createTask = useCreateTaskFromChatMessage(workspaceId);
  const { openTaskAction } = useChatTaskNav();

  const [title, setTitle] = useState(() => titleFromMessageBody(messageBody));
  const [projectId, setProjectId] = useState("");
  const [assignee, setAssignee] = useState<AssigneeRef | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [syncThread, setSyncThread] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    setTitle(titleFromMessageBody(messageBody));
    setProjectId("");
    setAssignee(null);
    setDueDate("");
    setSyncThread(false);
  }, [open, messageBody]);

  const trimmed = title.trim();
  const canSubmit = trimmed.length >= 1 && !!messageId && !createTask.isPending;

  const submit = () => {
    if (!canSubmit) return;
    setSubmitError(null);
    void createTask
      .mutateAsync({
        messageId,
        title: trimmed,
        project_id: projectId || undefined,
        assignee_id: assignee?.id,
        assignee_kind: assignee?.kind,
        due_date: dueDate || undefined,
        sync_thread: allowSyncThread ? syncThread : undefined,
      })
      .then((task) => {
        if (!task?.id) {
          setSubmitError(t("chat.link.create_error"));
          return;
        }
        toast.success(t("chat.link.created_toast"), { action: openTaskAction(task.id) });
        onOpenChange(false);
        onCreated?.(task.id);
      })
      .catch((err: unknown) => setSubmitError(chatErrorMessage(err, t, t("chat.link.create_error"))));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="lg">
        <FormDialogHeader
          title={t("chat.link.create_task_title")}
          description={t("chat.link.create_task_description")}
        />

        <FormDialogBody>
          <Label htmlFor="chat-task-title" className="-mb-2 px-1 text-caption text-muted-foreground">
            {t("chat.link.title_label")}
            <RequiredMark />
          </Label>
          <Input
            id="chat-task-title"
            aria-required
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (submitError) setSubmitError(null);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                submit();
              }
            }}
            autoFocus
            maxLength={TITLE_MAX_LENGTH}
            placeholder={t("tasks.detail.title_placeholder")}
            className={chatTaskTitleInput}
          />

          <div className="flex flex-wrap items-center gap-2">
            <ChatTaskProjectField workspaceId={workspaceId} value={projectId} onChange={setProjectId} />
            <ChatTaskAssigneeField workspaceId={workspaceId} value={assignee} onChange={setAssignee} />
            <ChatTaskDueField id="chat-task-due" value={dueDate} onChange={setDueDate} />
          </div>

          {allowSyncThread ? (
            <label className="flex cursor-pointer items-start gap-2.5 px-1">
              <Checkbox
                checked={syncThread}
                onCheckedChange={(next) => setSyncThread(next === true)}
                className="mt-0.5"
              />
              <span className="min-w-0 space-y-0.5">
                <span className="block text-body text-foreground">{t("chat.link.sync_thread")}</span>
                <span className="block text-caption text-muted-foreground">
                  {t("chat.link.sync_thread_hint")}
                </span>
              </span>
            </label>
          ) : null}
        </FormDialogBody>

        <FormDialogFooter
          onCancel={() => onOpenChange(false)}
          submitLabel={t("chat.link.create")}
          submittingLabel={t("chat.link.creating")}
          submitting={createTask.isPending}
          submitDisabled={!trimmed || !messageId}
          onSubmit={submit}
          leading={
            submitError || !trimmed ? (
              <ChatFormFooterNote error={submitError} hint={trimmed ? null : t("chat.link.title_required_hint")} />
            ) : undefined
          }
        />
      </FormDialogContent>
    </Dialog>
  );
}
