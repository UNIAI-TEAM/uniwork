"use client";

import { ChatInfoPanel } from "./chat-info-panel";
import type { ChatPageContentProps } from "./chat-page-content-props";

/**
 * The page's info panel for the open room: room data from the page, and its
 * actions mapped onto the page's sheets and dialogs. Over the conversation
 * (not docked) an action that shows something in the conversation closes
 * the panel first, so what it opened is not hidden under it.
 */
export function ChatPageInfoPanel({
  props,
  roomId,
  docked,
  onClose,
  workspaceMemberIds,
  channelMemberIds,
  onCatchUp,
  catchUpDisabled,
  onOpenRecordings,
}: {
  props: ChatPageContentProps;
  roomId: string;
  docked: boolean;
  onClose: () => void;
  workspaceMemberIds: readonly string[];
  channelMemberIds: readonly string[];
  onCatchUp?: () => void;
  catchUpDisabled?: boolean;
  onOpenRecordings?: () => void;
}) {
  const { target, activeChannel } = props;
  const inConversation = (action: () => void) => () => {
    if (!docked) onClose();
    action();
  };
  const openSettings = () => {
    if (target.kind === "workspace") props.onWorkspaceSettingsOpenChange(true);
    else if (target.kind === "group") props.onGroupSettingsOpenChange(true);
    else if (target.kind === "channel") props.onChannelSettingsOpenChange(true);
    else props.onDmSettingsOpenChange(true);
  };
  const canAddMembers = target.kind === "group" || (target.kind === "channel" && !activeChannel?.is_default);

  return (
    <ChatInfoPanel
      target={target}
      workspaceId={props.workspaceId}
      roomId={roomId}
      title={props.headerTitle}
      currentUserId={props.currentUserId}
      activeContact={props.activeContact}
      activeGroup={props.activeGroup}
      activeChannel={activeChannel}
      workspaceMemberIds={workspaceMemberIds}
      channelMemberIds={channelMemberIds}
      memberAvatarByUserId={props.memberAvatarByUserId}
      nicknamesByUserId={props.nicknamesByUserId}
      docked={docked}
      onClose={onClose}
      onSearch={inConversation(() => props.onMessageSearchOpenChange(true))}
      onVoiceCall={props.onVoiceCall}
      voiceCallDisabled={props.voiceCallDisabled}
      onVideoCall={props.onVideoCall}
      videoCallDisabled={props.videoCallDisabled}
      onAddMembers={canAddMembers ? () => props.onAddMembersOpenChange(true) : undefined}
      onOpenSettings={openSettings}
      onCatchUp={onCatchUp}
      catchUpDisabled={catchUpDisabled}
      onOpenRecordings={onOpenRecordings}
      onJumpToMessage={(messageId) => inConversation(() => props.onJumpToMessageIdChange(messageId))()}
    />
  );
}
