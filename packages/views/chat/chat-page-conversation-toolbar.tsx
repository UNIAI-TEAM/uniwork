"use client";

import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import type { ChatSidebarTarget } from "./chat-sidebar";
import { DmChatToolbar } from "./dm-settings-sheet";
import { GroupChatToolbar } from "./group-settings-sheet";
import { WorkspaceChatToolbar } from "./workspace-settings-sheet";

/** Conversation header toolbar for the active chat target. */
export function ChatPageConversationToolbar({
  target,
  headerTitle,
  contacts,
  activeContact,
  activeGroup,
  activeChannel,
  workspaceMembersCount,
  nicknamesByUserId,
  backToListLabel,
  sidebarCollapsed,
  onBack,
  onToggleSidebar,
  onOpenWorkspaceSettings,
  onOpenGroupSettings,
  onOpenChannelSettings,
  onOpenDmSettings,
  onOpenSearch,
  onVoiceCall,
  voiceCallDisabled,
  onVideoCall,
  videoCallDisabled,
}: {
  target: ChatSidebarTarget;
  headerTitle: string;
  contacts: ChatContact[];
  activeContact: ChatContact | null;
  activeGroup: GroupChat | null;
  activeChannel: ChatRoomRecord | null;
  workspaceMembersCount: number;
  nicknamesByUserId: Record<string, string>;
  backToListLabel: string;
  sidebarCollapsed: boolean;
  onBack: () => void;
  onToggleSidebar: () => void;
  onOpenWorkspaceSettings: () => void;
  onOpenGroupSettings: () => void;
  onOpenChannelSettings: () => void;
  onOpenDmSettings: () => void;
  onOpenSearch: () => void;
  onVoiceCall: () => void;
  voiceCallDisabled: boolean;
  onVideoCall: () => void;
  videoCallDisabled: boolean;
}) {
  if (target.kind === "workspace") {
    return (
      <WorkspaceChatToolbar
        title={headerTitle}
        memberCount={workspaceMembersCount}
        backAriaLabel={backToListLabel}
        onBack={onBack}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onOpenSettings={onOpenWorkspaceSettings}
        onOpenSearch={onOpenSearch}
      />
    );
  }
  if (target.kind === "group" && activeGroup) {
    return (
      <GroupChatToolbar
        title={headerTitle}
        memberCount={activeGroup.member_user_ids.length + 1}
        backAriaLabel={backToListLabel}
        onBack={onBack}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onOpenSettings={onOpenGroupSettings}
        onOpenSearch={onOpenSearch}
        onVoiceCall={onVoiceCall}
        voiceCallDisabled={voiceCallDisabled}
        onVideoCall={onVideoCall}
        videoCallDisabled={videoCallDisabled}
      />
    );
  }
  if (target.kind === "channel" && activeChannel) {
    return (
      <GroupChatToolbar
        title={headerTitle}
        memberCount={activeChannel.member_user_ids.length + 1}
        backAriaLabel={backToListLabel}
        onBack={onBack}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onOpenSettings={onOpenChannelSettings}
        onOpenSearch={onOpenSearch}
        onVoiceCall={onVoiceCall}
        voiceCallDisabled={voiceCallDisabled}
        onVideoCall={onVideoCall}
        videoCallDisabled={videoCallDisabled}
      />
    );
  }
  if (target.kind === "dm" && activeContact) {
    return (
      <DmChatToolbar
        contact={
          contacts.find((entry) => entry.user_id === activeContact.user_id) ??
          activeContact
        }
        nicknamesByUserId={nicknamesByUserId}
        backAriaLabel={backToListLabel}
        onBack={onBack}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onOpenSettings={onOpenDmSettings}
        onOpenSearch={onOpenSearch}
        onVoiceCall={onVoiceCall}
        voiceCallDisabled={voiceCallDisabled}
        onVideoCall={onVideoCall}
        videoCallDisabled={videoCallDisabled}
      />
    );
  }
  return null;
}

export function chatPageEmptyLabel(
  t: (key: string, options?: Record<string, string | number>) => string,
  target: ChatSidebarTarget,
  headerTitle: string,
  nicknamesByUserId: Record<string, string>,
): string {
  if (target.kind === "workspace") return t("chat.group_description");
  if (target.kind === "group") return t("chat.group_empty", { name: headerTitle });
  if (target.kind === "channel") return t("chat.channel.empty_thread", { name: headerTitle });
  if (target.kind === "dm") {
    return t("chat.dm_empty", {
      name: displayLabelForChatContact(target.contact, nicknamesByUserId),
    });
  }
  return t("chat.empty_description");
}
