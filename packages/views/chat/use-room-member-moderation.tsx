"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useRemoveChatRoomMember, useUpdateChatRoomMember } from "@uniwork/core/chat";
import { toastApiError } from "../toast-api-error";
import { ChatConfirmDialog } from "./chat-dialog-layout";

/**
 * Promote, demote, mute, unmute and remove for one room — the moderation the
 * group sheet and the workspace-room sheet share. One member is worked on at
 * a time; a failure says so; removing asks first, in the app's own dialog.
 */
export function useRoomMemberModeration({
  workspaceId,
  roomId,
}: {
  workspaceId: string;
  roomId: string;
}): {
  busyUserId: string | null;
  promote: (userId: string) => void;
  demote: (userId: string) => void;
  mute: (userId: string) => void;
  unmute: (userId: string) => void;
  requestRemove: (userId: string, label: string, confirmTitle: string) => void;
  confirmDialog: ReactNode;
} {
  const { t } = useTranslation();
  const updateMember = useUpdateChatRoomMember(workspaceId);
  const removeMember = useRemoveChatRoomMember(workspaceId);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ userId: string; title: string } | null>(null);

  const run = (userId: string, action: () => Promise<unknown>, onDone?: () => void) => {
    if (busyUserId) return;
    setBusyUserId(userId);
    void action()
      .then(onDone)
      .catch((err: unknown) => toastApiError(err, t("chat.member_action_failed")))
      .finally(() => setBusyUserId(null));
  };

  const update = (userId: string, patch: { role?: "admin" | "member"; send_restricted?: boolean }) =>
    run(userId, () => updateMember.mutateAsync({ roomId, userId, ...patch }));

  return {
    busyUserId,
    promote: (userId) => update(userId, { role: "admin" }),
    demote: (userId) => update(userId, { role: "member" }),
    mute: (userId) => update(userId, { send_restricted: true }),
    unmute: (userId) => update(userId, { send_restricted: false }),
    requestRemove: (userId, _label, confirmTitle) => setPendingRemove({ userId, title: confirmTitle }),
    confirmDialog: (
      <ChatConfirmDialog
        open={pendingRemove != null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
        title={pendingRemove?.title ?? ""}
        description={t("chat.remove_member_description")}
        confirmLabel={t("chat.remove_member_confirm")}
        pending={busyUserId != null}
        onConfirm={() => {
          if (!pendingRemove) return;
          const { userId } = pendingRemove;
          run(
            userId,
            () => removeMember.mutateAsync({ roomId, userId }),
            () => setPendingRemove(null),
          );
        }}
      />
    ),
  };
}
