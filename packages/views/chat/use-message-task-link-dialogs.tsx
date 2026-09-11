"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { ChatMessage } from "./chat-messages";
import { CreateTaskFromMessageDialog } from "./create-task-from-message-dialog";
import { LinkTaskDialog } from "./link-task-dialog";

export type MessageTaskLinkActions = {
  onCreateTask: (message: ChatMessage) => void;
  onLinkTask: (message: ChatMessage) => void;
};

/** Owns create/link task dialogs for the message panel; keeps the panel under max-lines. */
export function useMessageTaskLinkDialogs(
  workspaceId: string,
  enabled: boolean,
): {
  actions: MessageTaskLinkActions | null;
  dialogs: ReactNode;
} {
  const [createFor, setCreateFor] = useState<ChatMessage | null>(null);
  const [linkFor, setLinkFor] = useState<ChatMessage | null>(null);

  const onCreateTask = useCallback((message: ChatMessage) => {
    setCreateFor(message);
  }, []);
  const onLinkTask = useCallback((message: ChatMessage) => {
    setLinkFor(message);
  }, []);

  if (!enabled) {
    return { actions: null, dialogs: null };
  }

  const allowSyncThread = Boolean(createFor && !createFor.threadRootId);

  return {
    actions: { onCreateTask, onLinkTask },
    dialogs: (
      <>
        <CreateTaskFromMessageDialog
          open={createFor != null}
          onOpenChange={(open) => {
            if (!open) setCreateFor(null);
          }}
          workspaceId={workspaceId}
          messageId={createFor?.id ?? ""}
          messageBody={createFor?.body ?? ""}
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
