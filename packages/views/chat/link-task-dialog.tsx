"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLinkChatMessage } from "@uniwork/core/chat";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
import { TaskSearchSelectCard } from "../tasks/task-search-select-card";
import { CHAT_DIALOG_BODY_CLASS, CHAT_DIALOG_CLASS, CHAT_DIALOG_WIDTH } from "./chat-dialog-look";
import { chatErrorMessage } from "./chat-error-message";

export function LinkTaskDialog({
  open,
  onOpenChange,
  workspaceId,
  messageId,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  messageId: string;
  onLinked?: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const linkTask = useLinkChatMessage(workspaceId);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  // Kept with the id: a new search may no longer list the chosen task, and
  // the footer must still name what Submit will link.
  const [selectedTitle, setSelectedTitle] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const reset = () => {
    setQuery("");
    setSelectedId("");
    setSelectedTitle("");
    setLinkError(null);
  };

  const submit = () => {
    if (!selectedId || !messageId || linkTask.isPending) return;
    const taskId = selectedId;
    setLinkError(null);
    void linkTask
      .mutateAsync({ messageId, target_type: "task", target_id: taskId })
      .then((link) => {
        if (!link) {
          setLinkError(t("chat.link.link_error"));
          return;
        }
        reset();
        onOpenChange(false);
        onLinked?.(taskId);
      })
      .catch((err: unknown) => setLinkError(chatErrorMessage(err, t, t("chat.link.link_error"))));
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogContent size="md" className={`${CHAT_DIALOG_CLASS} ${CHAT_DIALOG_WIDTH.narrow}`}>
        <FormDialogHeader
          title={t("chat.link.link_task_title")}
          description={t("chat.link.link_task_description")}
        />

        <FormDialogBody className={`${CHAT_DIALOG_BODY_CLASS} space-y-2.5`}>
          <TaskSearchSelectCard
            workspaceId={workspaceId}
            enabled={open}
            query={query}
            onQueryChange={setQuery}
            selectedId={selectedId}
            onSelectTask={(task) => {
              setSelectedId(task.id);
              setSelectedTitle(task.title);
              setLinkError(null);
            }}
            retryButtonClassName="h-8.5 rounded-full px-3.5 font-semibold"
            copy={{
              listLabel: t("chat.link.task_list_aria"),
              searchPlaceholder: t("chat.link.search_placeholder"),
              searchLabel: t("chat.link.search_label"),
              loadingLabel: t("chat.link.loading"),
              loadErrorLabel: t("chat.link.tasks_load_error"),
              retryLabel: t("common.retry"),
              emptySearchLabel: t("chat.link.empty"),
              emptyWorkspaceLabel: t("chat.link.empty_workspace"),
              selectedOptionLabel: (title) => t("chat.link.task_option_selected", { title }),
              resultsCappedLabel: (count) => t("chat.link.results_capped", { count }),
            }}
          />

          {linkError ? (
            <p role="alert" className="text-caption text-destructive">
              {linkError}
            </p>
          ) : null}
        </FormDialogBody>

        <FormDialogFooter
          onCancel={() => handleOpenChange(false)}
          cancelVariant="secondary"
          submitLabel={t("chat.link.link")}
          submittingLabel={t("chat.link.linking")}
          submitting={linkTask.isPending}
          submitDisabled={!selectedId || !messageId}
          onSubmit={submit}
          leading={
            selectedTitle ? (
              <span className="line-clamp-1 text-foreground" aria-live="polite">
                {t("chat.link.selected_task", { title: selectedTitle })}
              </span>
            ) : undefined
          }
        />
      </FormDialogContent>
    </Dialog>
  );
}
