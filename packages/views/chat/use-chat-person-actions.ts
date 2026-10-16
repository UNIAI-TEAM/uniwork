"use client";

import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useResolveDMRoom } from "@uniwork/core/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { ChatSidebarTarget } from "./chat-sidebar";
import { toastChatError } from "./chat-error-message";
import { personDirectMessageContact } from "./chat-person-card";

/**
 * Message and call from a person's card. Both open that person's direct
 * conversation; a call rings it, and a video call rings it with the camera on.
 */
export function useChatPersonActions({
  workspaceId,
  currentUserId,
  nameContext,
  contacts,
  setTarget,
  startCall,
  closeSheets,
}: {
  workspaceId: string;
  currentUserId: string;
  nameContext: ReadonlyArray<{ user_id: string; display_name: string; email?: string }>;
  contacts: readonly ChatContact[];
  setTarget: (target: ChatSidebarTarget) => void;
  startCall: (
    roomId: string,
    label: string,
    callKind: "dm",
    options?: { withCamera?: boolean },
  ) => Promise<boolean>;
  closeSheets: () => void;
}) {
  const { t } = useTranslation();
  const { mutateAsync: resolveDm } = useResolveDMRoom(workspaceId);
  const latest = useRef({ closeSheets, contacts, currentUserId, nameContext, setTarget, startCall, t });
  latest.current = { closeSheets, contacts, currentUserId, nameContext, setTarget, startCall, t };

  const openDirectMessage = useCallback((userId: string): ChatContact | null => {
    const current = latest.current;
    const contact = personDirectMessageContact(userId, current.currentUserId, current.nameContext);
    if (!contact) return null;
    const known = current.contacts.find(
      (entry) => entry.user_id.trim().toUpperCase() === contact.user_id.trim().toUpperCase(),
    );
    const withRoom: ChatContact = known?.dm_room_id ? { ...contact, dm_room_id: known.dm_room_id } : contact;
    current.setTarget({ kind: "dm", contact: withRoom });
    current.closeSheets();
    return withRoom;
  }, []);

  const messagePerson = useCallback(
    (userId: string) => {
      openDirectMessage(userId);
    },
    [openDirectMessage],
  );

  const callPerson = useCallback(
    (userId: string, options?: { withCamera?: boolean }) => {
      const contact = openDirectMessage(userId);
      if (!contact) return;
      void (async () => {
        try {
          const roomId = contact.dm_room_id ?? (await resolveDm(contact.user_id))?.id;
          if (!roomId) {
            toastChatError(new Error("missing-room"), latest.current.t, latest.current.t("chat.voice_call_failed"));
            return;
          }
          const ring = latest.current.startCall;
          if (options?.withCamera) await ring(roomId, contact.display_name, "dm", { withCamera: true });
          else await ring(roomId, contact.display_name, "dm");
        } catch (err) {
          toastChatError(err, latest.current.t, latest.current.t("chat.voice_call_failed"));
        }
      })();
    },
    [openDirectMessage, resolveDm],
  );

  return { messagePerson, callPerson };
}
