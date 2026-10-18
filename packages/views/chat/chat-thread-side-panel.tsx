"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatRoomComposer, type ChatComposerHandle } from "./chat-composer";
import type { ComposerReadOnlyReason } from "./chat-composer-parts";
import type { MemberAvatarUrlMap } from "./chat-member-avatar";
import type { ChatMentionCandidate } from "./chat-mention-utils";
import type { ChatMessage } from "./chat-messages";
import type { NameContextEntry } from "./native-chat-message-mapping";
import { NativeChatMessagePanel } from "./native-chat-message-panel";
import { useChatInlineEdit } from "./use-chat-inline-edit";

/**
 * A thread beside the room's timeline (lg and up): "Chủ đề" and the room's
 * name, Follow and close, the root and its replies, and a reply field of its
 * own, so the timeline and its composer keep working next to it. Text,
 * emoji and stickers only: the thread API takes no files or voice.
 */
export function ChatThreadSidePanel({
  workspaceId,
  roomId,
  root,
  roomTitle,
  currentUserId,
  nameContext,
  canPinMessages,
  canModerate,
  canSendMessages,
  onFollowUp,
  onClose,
  draftKey,
  onSendReply,
  onSendMedia,
  composerDisabled,
  readOnlyReason,
  readOnlyPlaceholder,
  mentionCandidates,
  memberAvatarByUserId,
}: {
  workspaceId: string;
  roomId: string;
  root: ChatMessage;
  roomTitle: string;
  currentUserId: string;
  nameContext: NameContextEntry[];
  canPinMessages: boolean;
  canModerate: boolean;
  canSendMessages: boolean;
  onFollowUp?: (message: ChatMessage) => void;
  onClose: () => void;
  /** This thread's own draft, apart from the room's. */
  draftKey: string;
  onSendReply: (draftKey: string, rootId: string) => void;
  onSendMedia: (rootId: string, body: string) => void;
  composerDisabled: boolean;
  /** Why the room is read-only for this person, with the room composer's words for it. */
  readOnlyReason?: ComposerReadOnlyReason;
  readOnlyPlaceholder: string;
  mentionCandidates?: ChatMentionCandidate[];
  memberAvatarByUserId: MemberAvatarUrlMap;
}) {
  const { t } = useTranslation();
  const composerRef = useRef<ChatComposerHandle>(null);
  const focusComposer = useCallback(() => composerRef.current?.focus(), []);
  // Reply inside a thread behaves as it does in place: the quote shows, the send stays in the thread.
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const edit = useChatInlineEdit({ workspaceId, roomId, nameContext });

  // Opening a thread puts the caret in its reply field.
  useEffect(() => {
    focusComposer();
  }, [focusComposer, root.id]);

  return (
    <aside aria-label={t("chat.thread_title")} className="hidden w-100 shrink-0 flex-col border-l border-border bg-chat-wall lg:flex">
      <NativeChatMessagePanel
        workspaceId={workspaceId}
        roomId={roomId}
        currentUserId={currentUserId}
        nameContext={nameContext}
        youLabel={t("chat.you")}
        emptyLabel=""
        replyTo={replyTo}
        onReplyToChange={setReplyTo}
        showSenderName
        embedded
        threadsEnabled
        thread={root}
        onCloseThread={onClose}
        threadSubtitle={roomTitle}
        canPinMessages={canPinMessages}
        canModerate={canModerate}
        canSendMessages={canSendMessages}
        onFollowUp={onFollowUp}
        onFocusComposer={focusComposer}
        onEditMessage={edit.start}
      />
      <ChatRoomComposer
        ref={composerRef}
        workspaceId={workspaceId}
        draftKey={draftKey}
        onSend={() => onSendReply(draftKey, root.id)}
        onSendMedia={(body) => onSendMedia(root.id, body)}
        disabled={composerDisabled}
        readOnlyReason={readOnlyReason}
        placeholder={readOnlyReason ? readOnlyPlaceholder : t("chat.thread_reply_placeholder")}
        sendLabel={t("chat.send")}
        mentionCandidates={mentionCandidates}
        memberAvatarByUserId={memberAvatarByUserId}
        textOnly
        editing={
          edit.message
            ? { message: edit.message, saving: edit.saving, error: edit.error, onSave: (text) => void edit.save(text), onCancel: edit.cancel }
            : null
        }
      />
    </aside>
  );
}
