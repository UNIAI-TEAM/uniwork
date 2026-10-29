"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { ChatMessage } from "./chat-messages";
import { CreateTaskFromMessageDialog } from "./create-task-from-message-dialog";
import type { CreateTaskSourceMessage } from "./create-task-from-message-quote";
import { LinkTaskDialog } from "./link-task-dialog";

export type MessageTaskLinkActions = {
  onCreateTask: (message: ChatMessage) => void;
  onCreateTaskFromMessages: (messages: ChatMessage[]) => void;
  onLinkTask: (message: ChatMessage) => void;
};

function toSource(message: ChatMessage): CreateTaskSourceMessage {
  return { id: message.id, body: message.body, senderId: message.sender, sentAt: message.ts };
}

/** Owns create/link task dialogs for the message panel; keeps the panel under max-lines. */
export function useMessageTaskLinkDialogs(
  workspaceId: string,
  /** The conversation, named in the create dialog's quote of the message. */
  roomTitle?: string,
): {
  actions: MessageTaskLinkActions;
  dialogs: ReactNode;
} {
  const [createFor, setCreateFor] = useState<ChatMessage[] | null>(null);
  const [linkFor, setLinkFor] = useState<ChatMessage | null>(null);

  const onCreateTask = useCallback((message: ChatMessage) => {
    setCreateFor([message]);
  }, []);
  const onCreateTaskFromMessages = useCallback((messages: ChatMessage[]) => {
    if (messages.length === 0) return;
    setCreateFor([...messages].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id)));
  }, []);
  const onLinkTask = useCallback((message: ChatMessage) => {
    setLinkFor(message);
  }, []);
  const actions = useMemo(
    () => ({ onCreateTask, onCreateTaskFromMessages, onLinkTask }),
    [onCreateTask, onCreateTaskFromMessages, onLinkTask],
  );

  const sources = createFor?.map(toSource) ?? [];
  const anchor = sources[sources.length - 1];
  const allowSyncThread = Boolean(createFor?.length === 1 && createFor[0] && !createFor[0].threadRootId);

  return {
    actions,
    dialogs: (
      <>
        <CreateTaskFromMessageDialog
          open={createFor != null}
          onOpenChange={(open) => {
            if (!open) setCreateFor(null);
          }}
          workspaceId={workspaceId}
          messageId={anchor?.id ?? ""}
          messageBody={anchor?.body ?? ""}
          senderId={anchor?.senderId}
          sentAt={anchor?.sentAt}
          roomTitle={roomTitle}
          sourceMessages={sources}
          allowSyncThread={allowSyncThread}
        />
        <LinkTaskDialog
          open={linkFor != null}
          onOpenChange={(open) => {
            if (!open) setLinkFor(null);
          }}
          workspaceId={workspaceId}
          messageId={linkFor?.id ?? ""}
        />
      </>
    ),
  };
}
