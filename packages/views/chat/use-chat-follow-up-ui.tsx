"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ChatFollowUpRecord } from "@uniwork/core/api/endpoints/chat";
import {
  useConvertChatFollowUpToTask,
  useCreateChatFollowUp,
  useDeleteChatFollowUp,
  usePatchChatFollowUp,
} from "@uniwork/core/chat";
import type { ChatMessage } from "./chat-messages";
import { toastChatError } from "./chat-error-message";
import { ChatFollowUpsSheet } from "./chat-follow-ups-sheet";
import { useChatTaskNav } from "./use-chat-task-nav";

/** Follow-up create + list sheet for the message panel / chat page. */
export function useChatFollowUpUi(
  workspaceId: string,
  enabled: boolean,
): {
  onFollowUp: ((message: ChatMessage) => void) | undefined;
  openList: () => void;
  sheet: ReactNode;
} {
  const { t } = useTranslation();
  const [listOpen, setListOpen] = useState(false);
  // Rows with an action in flight. Only those rows hold still; the rest of
  // the list stays usable.
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const createFollowUp = useCreateChatFollowUp(workspaceId);
  const patchFollowUp = usePatchChatFollowUp(workspaceId);
  const deleteFollowUp = useDeleteChatFollowUp(workspaceId);
  const convertFollowUp = useConvertChatFollowUpToTask(workspaceId);
  const { openTaskAction } = useChatTaskNav();

  // Runs one row action; resolves true when it succeeded (the sheet then moves focus on).
  const track = useCallback((id: string, work: () => Promise<boolean>): Promise<boolean> => {
    setPendingIds((prev) => new Set(prev).add(id));
    return work().finally(() =>
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    );
  }, []);

  const onFollowUp = useCallback(
    (message: ChatMessage) => {
      void createFollowUp.mutateAsync({ messageId: message.id }).then(
        () => toast.success(t("chat.follow_up.created")),
        (err: unknown) => toastChatError(err, t, t("chat.follow_up.create_failed")),
      );
    },
    [createFollowUp, t],
  );

  // Deleting is light and reversible: it happens at once, and the toast
  // offers to put the follow-up back (same message, note and due date).
  const restore = (item: ChatFollowUpRecord) => {
    void createFollowUp
      .mutateAsync({
        messageId: item.message_id,
        ...(item.note.trim() ? { note: item.note } : {}),
        ...(item.due_at ? { due_at: item.due_at } : {}),
      })
      .then(
        () => toast.success(t("chat.follow_up.restored")),
        (err: unknown) => toastChatError(err, t, t("chat.follow_up.restore_failed")),
      );
  };

  if (!enabled) {
    return { onFollowUp: undefined, openList: () => undefined, sheet: null };
  }

  return {
    onFollowUp,
    openList: () => setListOpen(true),
    sheet: (
      <ChatFollowUpsSheet
        open={listOpen}
        onOpenChange={setListOpen}
        workspaceId={workspaceId}
        pendingIds={pendingIds}
        onComplete={(id) =>
          track(id, () =>
            patchFollowUp.mutateAsync({ followUpId: id, completed: true }).then(
              () => {
                toast.success(t("chat.follow_up.completed"));
                return true;
              },
              (err: unknown) => {
                toastChatError(err, t, t("chat.follow_up.update_failed"));
                return false;
              },
            ),
          )
        }
        onConvert={(id) =>
          track(id, () =>
            convertFollowUp.mutateAsync({ followUpId: id }).then(
              (task) => {
                toast.success(t("chat.follow_up.converted"), {
                  action: task?.id ? openTaskAction(task.id) : undefined,
                });
                return true;
              },
              (err: unknown) => {
                toastChatError(err, t, t("chat.follow_up.convert_failed"));
                return false;
              },
            ),
          )
        }
        onDelete={(item) =>
          track(item.id, () =>
            deleteFollowUp.mutateAsync(item.id).then(
              (ok) => {
                if (!ok) {
                  toast.error(t("chat.follow_up.delete_failed"));
                  return false;
                }
                toast.success(t("chat.follow_up.deleted"), {
                  action: { label: t("chat.follow_up.undo"), onClick: () => restore(item) },
                });
                return true;
              },
              (err: unknown) => {
                toastChatError(err, t, t("chat.follow_up.delete_failed"));
                return false;
              },
            ),
          )
        }
      />
    ),
  };
}
