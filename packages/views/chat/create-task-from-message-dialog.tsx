"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { titleFromMessageBody } from "@uniwork/core/chat/message-links";
import { useCreateTaskFromChatMessage } from "@uniwork/core/chat";
import { useMembers } from "@uniwork/core/workspaces";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";
import type { AssigneeRef } from "../tasks/pickers";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
import { ChatTaskAssigneeField, ChatTaskDueField, ChatTaskProjectField } from "./chat-task-peek-fields";
import { CHAT_DIALOG_BODY_CLASS, CHAT_DIALOG_CLASS, CHAT_DIALOG_WIDTH } from "./chat-dialog-look";
import { chatErrorMessage } from "./chat-error-message";
import { ChatFormFooterNote, RequiredMark } from "./chat-form-parts";
import { initialsOf } from "./chat-initials";
import { formatMessageTime } from "./chat-message-time";
import { chatPersonFaceClass } from "./chat-person-card";
import { senderNameClass, senderQuoteClass } from "./sender-colors";
import { memberDisplayLabel } from "./workspace-member-picker-utils";
import { useChatTaskNav } from "./use-chat-task-nav";

const TITLE_MAX_LENGTH = 200;

/** The big title field (canvas): 48px, display face, white with the ring while focused. */
const TITLE_INPUT_CLASS =
  "h-12 rounded-lg border-border bg-surface px-3 font-display text-title-lg font-bold md:text-title-lg focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-brand-subtle dark:bg-surface";

/** The message the task comes from, quoted on its sender's colour bar: face, name, time, words. */
function SourceMessageQuote({
  workspaceId,
  senderId,
  sentAt,
  roomTitle,
  body,
}: {
  workspaceId: string;
  senderId: string;
  sentAt?: number;
  roomTitle?: string;
  body: string;
}) {
  const { t, i18n } = useTranslation();
  const { data: members = [] } = useMembers(workspaceId);
  const member = members.find((entry) => entry.user_id === senderId);
  const name = member ? memberDisplayLabel(member) : t("chat.link.source_sender_unknown");
  return (
    <figure
      aria-label={t("chat.link.source_message")}
      className={cn(senderQuoteClass(senderId), "flex gap-2.5 rounded-lg border-l-3 bg-muted px-3 py-2.5")}
    >
      <ActorAvatar
        name={name}
        initials={initialsOf(name)}
        size="fluid"
        className={cn("size-7 text-micro", chatPersonFaceClass(senderId))}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className={cn("truncate text-label font-semibold", senderNameClass(senderId, false))}>{name}</span>
          {sentAt || roomTitle ? (
            // Where and when it was said: "Ra mắt UniWork Q4 · 10:18" (canvas).
            <span className="min-w-0 truncate text-caption text-muted-foreground tabular-nums">
              {[roomTitle, sentAt ? formatMessageTime(sentAt, i18n.language) : ""].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </span>
        <span className="line-clamp-3 text-body text-foreground">{body}</span>
      </span>
    </figure>
  );
}

/** Create a task from a chat message: big title, property chips, one action. */
export function CreateTaskFromMessageDialog({
  open,
  onOpenChange,
  workspaceId,
  messageId,
  messageBody,
  senderId,
  sentAt,
  roomTitle,
  allowSyncThread = false,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  messageId: string;
  messageBody: string;
  /** Who wrote the message and when: the dialog quotes it above the title. */
  senderId?: string;
  sentAt?: number;
  /** The conversation it was said in, beside the time in the quote. */
  roomTitle?: string;
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
      <FormDialogContent size="lg" className={`${CHAT_DIALOG_CLASS} ${CHAT_DIALOG_WIDTH.form}`}>
        <FormDialogHeader
          title={t("chat.link.create_task_title")}
          description={t("chat.link.create_task_description")}
        />

        <FormDialogBody className={CHAT_DIALOG_BODY_CLASS}>
          {senderId && messageBody.trim() ? (
            <SourceMessageQuote
              workspaceId={workspaceId}
              senderId={senderId}
              sentAt={sentAt}
              roomTitle={roomTitle}
              body={messageBody}
            />
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="chat-task-title" className="gap-0 px-0.5 text-caption leading-4 font-semibold text-muted-foreground">
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
              className={TITLE_INPUT_CLASS}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ChatTaskProjectField workspaceId={workspaceId} value={projectId} onChange={setProjectId} />
            <ChatTaskAssigneeField workspaceId={workspaceId} value={assignee} onChange={setAssignee} />
            <ChatTaskDueField id="chat-task-due" value={dueDate} onChange={setDueDate} />
          </div>

          {allowSyncThread ? (
            <label className="flex cursor-pointer items-start gap-2.5 px-0.5 py-1">
              <Checkbox
                checked={syncThread}
                onCheckedChange={(next) => setSyncThread(next === true)}
                className="mt-px size-5 rounded-md [&_svg]:size-3.5"
              />
              <span className="min-w-0 space-y-0.5">
                <span className="block text-body-lg text-foreground">{t("chat.link.sync_thread")}</span>
                <span className="block text-caption text-muted-foreground">
                  {t("chat.link.sync_thread_hint")}
                </span>
              </span>
            </label>
          ) : null}
        </FormDialogBody>

        <FormDialogFooter
          onCancel={() => onOpenChange(false)}
          cancelVariant="secondary"
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
