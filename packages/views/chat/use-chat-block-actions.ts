"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBlockChatUser, useUnblockChatUser } from "@uniwork/core/chat";
import { chatErrorMessage } from "./chat-error-message";

/**
 * Block / unblock the DM peer of the open conversation. `onBlocked` runs after
 * a successful block (the page leaves the conversation); failures surface
 * through `setConnectError`.
 */
export function useChatBlockActions({
  workspaceId,
  peerUserId,
  setConnectError,
  onBlocked,
}: {
  workspaceId: string;
  peerUserId: string | null;
  setConnectError: (message: string | null) => void;
  onBlocked: () => void;
}) {
  const { t } = useTranslation();
  const blockUser = useBlockChatUser(workspaceId);
  const unblockUser = useUnblockChatUser(workspaceId);
  const [blockingContact, setBlockingContact] = useState(false);
  const [unblockingContact, setUnblockingContact] = useState(false);

  const handleBlockContact = useCallback(async () => {
    if (!peerUserId) return;
    setBlockingContact(true);
    setConnectError(null);
    try {
      await blockUser.mutateAsync(peerUserId);
      onBlocked();
    } catch (err: unknown) {
      setConnectError(chatErrorMessage(err, t, t("chat.block_failed")));
    } finally {
      setBlockingContact(false);
    }
  }, [peerUserId, blockUser, onBlocked, setConnectError, t]);

  const handleUnblockContact = useCallback(async () => {
    if (!peerUserId) return;
    setUnblockingContact(true);
    setConnectError(null);
    try {
      await unblockUser.mutateAsync(peerUserId);
    } catch (err: unknown) {
      setConnectError(chatErrorMessage(err, t, t("chat.unblock_failed")));
    } finally {
      setUnblockingContact(false);
    }
  }, [peerUserId, unblockUser, setConnectError, t]);

  return { blockingContact, unblockingContact, handleBlockContact, handleUnblockContact };
}
