"use client";

import type { ReactNode, RefObject } from "react";
import { useChatRooms } from "@uniwork/core/chat";
import { ChatRoomComposer, type ChatComposerHandle, type ComposerAttachAction } from "./chat-composer";
import { chatComposerBlockProps } from "./chat-composer-placeholder";
import { ChatUnreadProvider } from "./chat-day-separator";
import { ChatMessageSearchBar } from "./chat-message-search-bar";
import type { ChatMessage } from "./chat-messages";
import {
  CHAT_WAVE,
  ChatPageConversationIntro,
  ChatPageConversationToolbar,
  chatPageEmptyLabel,
} from "./chat-page-conversation-toolbar";
import type { ChatPageContentProps } from "./chat-page-content-props";
import { ChatPinnedMessagesBar } from "./chat-pinned-messages-bar";
import { senderLabelFor } from "./native-chat-message-mapping";
import { NativeChatMessagePanel } from "./native-chat-message-panel";
import type { useChatCatchUpUi } from "./use-chat-catch-up-ui";
import { useChatInlineEdit } from "./use-chat-inline-edit";

/**
 * The open room: its header, search (below the header, which stays) or the
 * pinned bar, the timeline and the composer. "Sửa" edits in the composer; a
 * thread opens beside the timeline when the page has room for it.
 */
export function ChatPageConversation({
  props,
  activeRoomId,
  catchUp,
  onFollowUp,
  sidebarCollapsed,
  onBack,
  onToggleSidebar,
  onAttachAction,
  composerRef,
  focusComposer,
  onOpenSideThread,
  sideThreadRootId,
  panelOpen,
  onTogglePanel,
  workspaceMemberIds,
  channelMemberIds,
  notices,
}: {
  props: ChatPageContentProps;
  activeRoomId: string;
  catchUp: ReturnType<typeof useChatCatchUpUi>;
  onFollowUp?: (message: ChatMessage) => void;
  sidebarCollapsed: boolean;
  onBack: () => void;
  onToggleSidebar: () => void;
  onAttachAction: (action: ComposerAttachAction) => void;
  composerRef: RefObject<ChatComposerHandle | null>;
  focusComposer: () => void;
  /** Set from lg: threads open in the side panel instead of in the timeline. */
  onOpenSideThread?: (message: ChatMessage) => void;
  sideThreadRootId: string | null;
  /** The info panel shows; the header's last action toggles it. */
  panelOpen: boolean;
  onTogglePanel: () => void;
  workspaceMemberIds: readonly string[];
  channelMemberIds: readonly string[];
  /** Connection, outbox and room notices: under the header, over the pins (canvas). */
  notices: ReactNode;
}) {
  const {
    t,
    target,
    workspaceId,
    currentUserId,
    nameContext,
    headerTitle,
    nicknamesByUserId,
    memberAvatarByUserId,
    workspaceMembers,
    messageSearchOpen,
    onMessageSearchOpenChange,
    onJumpToMessageIdChange,
    canPinMessages,
    dmBlocked,
    chatSendRestricted,
  } = props;
  const edit = useChatInlineEdit({ workspaceId, roomId: activeRoomId, nameContext });
  const { data: rooms } = useChatRooms(workspaceId);
  const roomWorkspaceId = rooms?.find((room) => room.id === activeRoomId)?.workspace_id;
  // Threads, mentions and sender names belong to rooms with more than two people.
  const many = target.kind !== "dm";

  return (
    <>
      <ChatPageConversationToolbar
        target={target}
        headerTitle={headerTitle}
        contacts={props.contacts}
        activeContact={props.activeContact}
        activeGroup={props.activeGroup}
        activeChannel={props.activeChannel}
        workspaceMemberIds={workspaceMemberIds}
        channelMemberIds={channelMemberIds}
        roomWorkspaceId={roomWorkspaceId}
        nicknamesByUserId={nicknamesByUserId}
        memberAvatarByUserId={memberAvatarByUserId}
        typingLabel={props.typingLabel}
        backAriaLabel={t("chat.back_to_conversations")}
        sidebarCollapsed={sidebarCollapsed}
        onBack={onBack}
        onToggleSidebar={onToggleSidebar}
        panelOpen={panelOpen}
        onTogglePanel={onTogglePanel}
        onCatchUp={catchUp.onCatchUp}
        catchUpDisabled={catchUp.loading}
        onVoiceCall={props.onVoiceCall}
        voiceCallDisabled={props.voiceCallDisabled}
        onVideoCall={props.onVideoCall}
        videoCallDisabled={props.videoCallDisabled}
        onSearch={() => onMessageSearchOpenChange((open) => !open)}
        searchOpen={messageSearchOpen}
      />
      {notices}
      {messageSearchOpen ? (
        <ChatMessageSearchBar
          workspaceId={workspaceId}
          roomId={activeRoomId}
          currentUserId={currentUserId}
          nameContext={nameContext}
          youLabel={t("chat.you")}
          onClose={() => onMessageSearchOpenChange(false)}
          onJumpToMessage={onJumpToMessageIdChange}
        />
      ) : (
        <ChatPinnedMessagesBar
          workspaceId={workspaceId}
          roomId={activeRoomId}
          canPinMessages={canPinMessages}
          onJumpToMessage={onJumpToMessageIdChange}
        />
      )}

      {/* The room's unread count and brief; a thread open in place keeps the plain "Tin mới".
          The box is the anchor the cross-workspace toast sits in (12px down, 16px in). */}
      <div data-chat-toast-anchor="" className="relative flex min-h-0 flex-1 flex-col">
        <ChatUnreadProvider
          value={props.activeThreadRootId ? { count: null } : { count: catchUp.unreadCount, onCatchUp: catchUp.onCatchUpRoom }}
        >
          <NativeChatMessagePanel
            workspaceId={workspaceId}
            roomId={activeRoomId}
            currentUserId={currentUserId}
            nameContext={nameContext}
            roomTitle={headerTitle}
            youLabel={t("chat.you")}
            emptyLabel={chatPageEmptyLabel(t, target, headerTitle, nicknamesByUserId)}
            intro={
              <ChatPageConversationIntro
                target={target}
                headerTitle={headerTitle}
                activeChannel={props.activeChannel}
                nicknamesByUserId={nicknamesByUserId}
                t={t}
                onViewMembers={() => props.onWorkspaceSettingsOpenChange(true)}
                onAddMembers={() => props.onAddMembersOpenChange(true)}
                workspaceMembers={workspaceMembers}
                currentUserId={currentUserId}
                memberAvatarByUserId={memberAvatarByUserId}
                onWave={dmBlocked || chatSendRestricted ? undefined : () => void props.onSendMedia(CHAT_WAVE)}
              />
            }
            replyTo={props.replyTo}
            onReplyToChange={props.onReplyToChange}
            threadsEnabled={many}
            onFollowUp={onFollowUp}
            onActiveThreadRootIdChange={props.onActiveThreadRootIdChange}
            onOpenThread={onOpenSideThread}
            openThreadRootId={sideThreadRootId}
            unreadSince={catchUp.unreadSince}
            refreshKey={props.messageRefreshKey}
            showSenderName={many}
            embedded
            anchorMessageId={props.jumpToMessageId}
            onClearAnchor={() => onJumpToMessageIdChange(null)}
            canPinMessages={canPinMessages}
            canModerate={props.canModerate}
            canSendMessages={!dmBlocked && !chatSendRestricted}
            onFocusComposer={focusComposer}
            onEditMessage={edit.start}
            peerLastReadAt={props.peerLastReadAt}
          />
        </ChatUnreadProvider>
      </div>

      <ChatRoomComposer
        ref={composerRef}
        workspaceId={workspaceId}
        draftKey={props.composerDraftKey}
        composerPriority={props.composerPriority}
        onComposerPriorityChange={props.onComposerPriorityChange}
        onSend={props.onSend}
        onSendMedia={props.onSendMedia}
        onSendVoice={props.onSendVoice}
        onSendFile={props.onSendFile}
        disabled={props.showLoading || dmBlocked || chatSendRestricted}
        mentionCandidates={many ? props.mentionCandidates : undefined}
        memberAvatarByUserId={memberAvatarByUserId}
        {...chatComposerBlockProps(t, {
          dmBlocked,
          chatSendMutedByModerator: props.chatSendMutedByModerator,
          chatSendRestricted,
        })}
        sendLabel={t("chat.send")}
        blockedByMe={props.dmBlockedByMe}
        onUnblock={props.onUnblockContact}
        unblocking={props.unblockingContact}
        replyTo={props.replyTo}
        replyToSenderLabel={
          props.replyTo ? senderLabelFor(props.replyTo, currentUserId, t("chat.you"), nameContext) : undefined
        }
        onCancelReply={() => {
          props.onReplyToChange(null);
          focusComposer();
        }}
        typingLabel={props.typingLabel}
        onAttachAction={onAttachAction}
        showCreatePoll={props.canCreatePolls && many}
        editing={
          edit.message
            ? { message: edit.message, saving: edit.saving, error: edit.error, onSave: (text) => void edit.save(text), onCancel: edit.cancel }
            : null
        }
      />
    </>
  );
}
