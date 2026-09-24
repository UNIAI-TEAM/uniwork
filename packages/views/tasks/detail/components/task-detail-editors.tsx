"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import {
  useAddTaskReaction,
  useComments,
  useRemoveTaskReaction,
  useTaskAttachments,
  useUploadTaskAttachment,
} from "@uniwork/core/tasks";
import type { Task } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { FileUploadButton } from "@uniwork/ui/components/common/file-upload-button";
import { ReactionBar } from "@uniwork/ui/components/common/reaction-bar";
import {
  ContentEditor,
  type ContentEditorRef,
  TitleEditor,
  type TitleEditorRef,
  FileDropOverlay,
  useEditorUpload,
  useFileDropZone,
  useLazyEditor,
} from "../../../editor";
import { toastApiError } from "../../../toast-api-error";
import { TaskDetailAttachmentsSlot } from "./task-detail-attachments-slot";
import { TaskDetailContextLine } from "./task-detail-context-line";
import { TaskDetailSubtasksSection } from "./subtasks-section";
import { TaskDetailTimelineSlot } from "./task-detail-timeline-slot";

export function TaskDetailEditors({
  task,
  workspaceId,
  onSaveTitle,
  onSaveDescription,
  scrollContainerRef,
}: {
  task: Task;
  workspaceId: string;
  onSaveTitle: (title: string) => void;
  onSaveDescription: (markdown: string) => void;
  scrollContainerRef?: (el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const titleEditorRef = useRef<TitleEditorRef>(null);
  const descEditorRef = useRef<ContentEditorRef>(null);
  const [liveDescription, setLiveDescription] = useState(task.description ?? "");
  const currentUser = useAuthStore((state) => state.user);
  const members = useMembers(workspaceId);
  const attachments = useTaskAttachments(workspaceId, task.id);
  const comments = useComments(task.id);
  const uploadMutation = useUploadTaskAttachment(workspaceId, task.id);
  const addReaction = useAddTaskReaction(task.id);
  const removeReaction = useRemoveTaskReaction(task.id);
  const { upload, uploading } = useEditorUpload(async (file) => {
    const attachment = await uploadMutation.mutateAsync(file);
    if (!attachment) throw new Error("upload failed");
    return attachment;
  });
  const uploadIntoDescription = useCallback(
    (file: File) => upload(file, { taskId: task.id }),
    [task.id, upload],
  );
  const { isDragOver, dropZoneProps } = useFileDropZone({
    onDrop: (files) => files.forEach((file) => descEditorRef.current?.uploadFile(file)),
    enabled: !uploading,
  });
  const actorNames = useMemo(
    () =>
      new Map(
        (members.data ?? []).map((member) => [member.user_id, member.display_name] as const),
      ),
    [members.data],
  );
  const attachmentReferences = useMemo(
    () => [liveDescription, ...(comments.data ?? []).map((comment) => comment.body)].join("\n"),
    [comments.data, liveDescription],
  );
  const toggleReaction = (emoji: string) => {
    if (!currentUser || addReaction.isPending || removeReaction.isPending) return;
    const reacted = (task.reactions ?? []).some(
      (reaction) =>
        reaction.emoji === emoji &&
        reaction.actor_type === "member" &&
        reaction.actor_id === currentUser.id,
    );
    const mutation = reacted ? removeReaction : addReaction;
    void mutation.mutateAsync(emoji).catch((error: unknown) => {
      toastApiError(error, t("common.error"));
    });
  };
  const titleLazy = useLazyEditor({
    editorRef: titleEditorRef,
    resetKey: task.id,
  });

  useEffect(() => {
    setLiveDescription(task.description ?? "");
  }, [task.description, task.id]);

  return (
    <div
      ref={scrollContainerRef}
      className="relative h-full flex-1 overflow-y-auto [scrollbar-gutter:stable]"
    >
      <div className="mx-auto w-full max-w-4xl px-3 py-6 md:px-8 md:py-8">
        <section
          aria-label={t("tasks.detail.title_region")}
          className="min-w-0"
        >
          {titleLazy.active ? (
            <div className={titleLazy.ready ? undefined : "hidden"}>
              <TitleEditor
                key={`title-${task.id}`}
                ref={titleEditorRef}
                defaultValue={task.title}
                placeholder={t("tasks.detail.title_placeholder")}
                className="w-full text-display-sm font-bold leading-snug tracking-tight"
                onReady={titleLazy.onReady}
                onBlur={(value) => {
                  const trimmed = value.trim();
                  if (trimmed && trimmed !== task.title) {
                    onSaveTitle(trimmed);
                  }
                }}
              />
            </div>
          ) : null}
          {!titleLazy.ready ? (
            <div
              role="button"
              tabIndex={0}
              className="w-full cursor-text text-display-sm font-bold leading-snug tracking-tight text-foreground"
              onClick={(e) => {
                const sel = window.getSelection();
                if (sel && !sel.isCollapsed) return;
                titleLazy.activate({ x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  titleLazy.activate();
                }
              }}
            >
              {task.title || t("tasks.detail.title_placeholder")}
            </div>
          ) : null}
        </section>

        <TaskDetailContextLine workspaceId={workspaceId} task={task} />

        <div className="relative mt-5 rounded-lg" {...dropZoneProps}>
          <ContentEditor
            ref={descEditorRef}
            key={task.id}
            value={task.description ?? ""}
            placeholder={t("tasks.detail.description_placeholder")}
            onDocumentChange={setLiveDescription}
            onUpdate={(md) => {
              if (md !== (task.description ?? "")) {
                onSaveDescription(md);
              }
            }}
            debounceMs={1500}
            flushPendingOnUnmount
            currentTaskId={task.id}
            attachments={attachments.data}
            onUploadFile={(file) => uploadIntoDescription(file)}
            disableMentions
          />
          <div className="mt-3 flex items-center gap-1">
            <ReactionBar
              reactions={task.reactions ?? []}
              currentUserId={currentUser?.id}
              onToggle={toggleReaction}
              getActorName={(type, id) =>
                type === "member" ? actorNames.get(id) ?? id : id
              }
            />
            <FileUploadButton
              size="sm"
              multiple
              disabled={uploading}
              onSelect={(file) => descEditorRef.current?.uploadFile(file)}
            />
          </div>
          {isDragOver ? <FileDropOverlay /> : null}
        </div>

        <TaskDetailAttachmentsSlot
          workspaceId={workspaceId}
          taskId={task.id}
          content={attachmentReferences}
        />
        <TaskDetailSubtasksSection workspaceId={workspaceId} taskId={task.id} />
        <TaskDetailTimelineSlot workspaceId={workspaceId} taskId={task.id} />
      </div>
    </div>
  );
}
