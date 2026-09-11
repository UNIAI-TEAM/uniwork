"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useConvertChatFollowUpToTask,
  useCreateChatFollowUp,
  useDeleteChatFollowUp,
  usePatchChatFollowUp,
} from "@uniwork/core/chat";
import { apiErrorMessage } from "@uniwork/core/api/http";
import type { ChatMessage } from "./chat-messages";
import { ChatFollowUpsSheet } from "./chat-follow-ups-sheet";

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
  const createFollowUp = useCreateChatFollowUp(workspaceId);
  const patchFollowUp = usePatchChatFollowUp(workspaceId);
  const deleteFollowUp = useDeleteChatFollowUp(workspaceId);
  const convertFollowUp = useConvertChatFollowUpToTask(workspaceId);

  const onFollowUp = useCallback(
    (message: ChatMessage) => {
      void (async () => {
        try {
          await createFollowUp.mutateAsync({ messageId: message.id });
          toast.success(t("chat.follow_up.created"));
        } catch (err) {
          toast.error(apiErrorMessage(err) || t("chat.follow_up.create_failed"));
        }
      })();
    },
    [createFollowUp, t],
  );

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
        onComplete={(id) => {
          void patchFollowUp.mutateAsync({ followUpId: id, completed: true }).then(
            () => toast.success(t("chat.follow_up.completed")),
            (err: unknown) => toast.error(apiErrorMessage(err) || t("chat.follow_up.update_failed")),
          );
        }}
        onConvert={(id) => {
          void convertFollowUp.mutateAsync({ followUpId: id }).then(
            () => toast.success(t("chat.follow_up.converted")),
            (err: unknown) => toast.error(apiErrorMessage(err) || t("chat.follow_up.convert_failed")),
          );
        }}
        onDelete={(id) => {
          void deleteFollowUp.mutateAsync(id).then(
            () => toast.success(t("chat.follow_up.deleted")),
            (err: unknown) => toast.error(apiErrorMessage(err) || t("chat.follow_up.delete_failed")),
          );
        }}
        busy={
          patchFollowUp.isPending || convertFollowUp.isPending || deleteFollowUp.isPending
        }
      />
    ),
  };
}
