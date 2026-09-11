"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, FolderKanban, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { titleFromMessageBody } from "@uniwork/core/chat/message-links";
import { useCreateTaskFromChatMessage } from "@uniwork/core/chat";
import { useProjects } from "@uniwork/core/tasks";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../common/date-field";
import { toastApiError } from "../toast-api-error";

const NONE = "__none__";

const pillTrigger =
  "h-8 gap-1 rounded-full border border-border/80 bg-muted/40 px-2.5 text-caption font-medium shadow-none hover:bg-muted";

/** ClickUp-style create sheet: big title + property chips, not a labeled form. */
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
  const { data: projectList } = useProjects(workspaceId);
  const projects = useMemo(() => projectList?.projects ?? [], [projectList]);
  const { data: members = [] } = useMembers(workspaceId);

  const [title, setTitle] = useState(() => titleFromMessageBody(messageBody));
  const [projectId, setProjectId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [syncThread, setSyncThread] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(titleFromMessageBody(messageBody));
    setProjectId("");
    setAssigneeId("");
    setDueDate("");
    setSyncThread(false);
  }, [open, messageBody]);

  const trimmed = title.trim();
  const canSubmit = trimmed.length >= 1 && !!messageId && !createTask.isPending;

  const projectLabel = useMemo(() => {
    if (!projectId) return t("chat.link.project_none");
    return projects.find((p) => p.id === projectId)?.title ?? t("chat.link.project_none");
  }, [projectId, projects, t]);

  const assigneeLabel = useMemo(() => {
    if (!assigneeId) return t("chat.link.assignee_none");
    const m = members.find((member) => member.user_id === assigneeId);
    return m?.display_name?.trim() || m?.email || t("chat.link.assignee_none");
  }, [assigneeId, members, t]);

  const submit = () => {
    if (!canSubmit) return;
    void createTask
      .mutateAsync({
        messageId,
        title: trimmed,
        project_id: projectId || undefined,
        assignee_id: assigneeId || undefined,
        assignee_kind: assigneeId ? "human" : undefined,
        due_date: dueDate || undefined,
        sync_thread: allowSyncThread ? syncThread : undefined,
      })
      .then((task) => {
        if (!task?.id) return;
        onOpenChange(false);
        onCreated?.(task.id);
      })
      .catch((err: unknown) => toastApiError(err, t("common.error")));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(88vh,36rem)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton
        data-testid="create-task-from-message-dialog"
      >
        <DialogTitle className="sr-only">{t("chat.link.create_task_title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("chat.link.create_task_description")}
        </DialogDescription>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-4 pt-5 pr-14">
          <p className="mb-3 text-caption font-medium tracking-wide text-muted-foreground">
            {t("chat.link.create_task_title")}
          </p>

          <input
            id="chat-task-title"
            aria-label={t("chat.link.title_label")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                submit();
              }
            }}
            autoFocus
            maxLength={200}
            placeholder={t("tasks.detail.title_placeholder")}
            className={cn(
              "w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-display-sm font-bold leading-snug tracking-tight text-foreground outline-none",
              "placeholder:text-muted-foreground/60 hover:border-border/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
            )}
          />

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <DropdownMenu modal={false} open={projectOpen} onOpenChange={setProjectOpen}>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={pillTrigger}
                    aria-label={t("chat.link.project_label")}
                  />
                }
              >
                <FolderKanban className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="max-w-40 truncate">{projectLabel}</span>
                <ChevronDown className="size-3.5 opacity-60" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="z-[60] min-w-52">
                <DropdownMenuRadioGroup
                  value={projectId || NONE}
                  onValueChange={(value) => {
                    setProjectId(!value || value === NONE ? "" : value);
                    setProjectOpen(false);
                  }}
                >
                  <DropdownMenuRadioItem value={NONE}>
                    {t("chat.link.project_none")}
                  </DropdownMenuRadioItem>
                  {projects.map((project) => (
                    <DropdownMenuRadioItem key={project.id} value={project.id}>
                      {project.title}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu modal={false} open={assigneeOpen} onOpenChange={setAssigneeOpen}>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={pillTrigger}
                    aria-label={t("chat.link.assignee_label")}
                  />
                }
              >
                <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="max-w-36 truncate">{assigneeLabel}</span>
                <ChevronDown className="size-3.5 opacity-60" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="z-[60] min-w-52">
                <DropdownMenuRadioGroup
                  value={assigneeId || NONE}
                  onValueChange={(value) => {
                    setAssigneeId(!value || value === NONE ? "" : value);
                    setAssigneeOpen(false);
                  }}
                >
                  <DropdownMenuRadioItem value={NONE}>
                    {t("chat.link.assignee_none")}
                  </DropdownMenuRadioItem>
                  {members.map((member) => (
                    <DropdownMenuRadioItem key={member.user_id} value={member.user_id}>
                      {member.display_name?.trim() || member.email}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DateField
              id="chat-task-due"
              value={dueDate}
              onChange={setDueDate}
              modal={false}
              className={cn(pillTrigger, "w-auto min-w-0 focus-visible:ring-1")}
            />
          </div>

          {allowSyncThread ? (
            <label className="mt-5 flex cursor-pointer items-start gap-2.5 px-1">
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
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border px-5 py-4 sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("chat.link.cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {createTask.isPending ? t("chat.link.creating") : t("chat.link.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
