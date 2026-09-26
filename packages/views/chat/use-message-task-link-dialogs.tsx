"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { ChatMessage } from "./chat-messages";
import { CreateTaskFromMessageDialog } from "./create-task-from-message-dialog";
import { LinkTaskDialog } from "./link-task-dialog";

export type MessageTaskLinkActions = {
  onCreateTask: (message: ChatMessage) => void;
  onLinkTask: (message: ChatMessage) => void;
};

/** Owns create/link task dialogs for the message panel; keeps the panel under max-lines. */
export function useMessageTaskLinkDialogs(workspaceId: string): {
  actions: MessageTaskLinkActions;
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
  // Stable, so the message rows memoised on their actions do not re-render.
  const actions = useMemo(() => ({ onCreateTask, onLinkTask }), [onCreateTask, onLinkTask]);

  const allowSyncThread = Boolean(createFor && !createFor.threadRootId);

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
