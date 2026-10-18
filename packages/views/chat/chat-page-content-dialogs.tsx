"use client";

import { AddGroupMembersDialog } from "./add-group-members-dialog";
import { ChannelSettingsSheet } from "./channel-settings-sheet";
import { ChatCreatePollDialog } from "./chat-create-poll-dialog";
import { ChatCreateReminderDialog } from "./chat-create-reminder-dialog";
import { ChatCreateNoteDialog } from "./chat-create-note-dialog";
import { ChatCreatePostDialog } from "./chat-create-post-dialog";
import { DmSettingsSheet } from "./dm-settings-sheet";
import { GroupSettingsSheet } from "./group-settings-sheet";
import type { ChatMemberMessageTarget } from "./chat-member-profile";
import { WorkspaceSettingsSheet } from "./workspace-settings-sheet";
import type { ChatPageContentProps } from "./chat-page-content-props";

type ChatPageContentDialogsProps = Pick<
  ChatPageContentProps,
  | "target"
  | "workspaceId"
  | "headerTitle"
  | "contacts"
  | "activeContact"
  | "activeGroup"
  | "activeChannel"
  | "currentUserId"
  | "workspaceRoomId"
  | "nicknamesByUserId"
  | "groupMemberProfiles"
  | "groupSettingsOpen"
  | "onGroupSettingsOpenChange"
  | "dmSettingsOpen"
  | "onDmSettingsOpenChange"
  | "channelSettingsOpen"
  | "onChannelSettingsOpenChange"
  | "setTarget"
  | "dmBlockedByMe"
  | "dmBlockedMe"
  | "onBlockContact"
  | "onUnblockContact"
  | "blockingContact"
  | "unblockingContact"
  | "addMembersOpen"
  | "onAddMembersOpenChange"
  | "invitingMembers"
  | "onAddGroupMembers"
  | "leavingConversation"
  | "onLeaveGroup"
  | "onLeaveDm"
  | "onLeaveChannel"
  | "workspaceMembers"
  | "memberAvatarByUserId"
  | "workspaceSettingsOpen"
  | "onWorkspaceSettingsOpenChange"
  | "activeRoomId"
  | "canPinMessages"
  | "t"
  | "onMessageSearchOpenChange"
  | "onVoiceCall"
  | "voiceCallDisabled"
  | "onVideoCall"
  | "videoCallDisabled"
> & {
  createPollOpen: boolean;
  onCreatePollOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  createReminderOpen: boolean;
  onCreateReminderOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  createNoteOpen: boolean;
  onCreateNoteOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  createPostOpen: boolean;
  onCreatePostOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
};

export function ChatPageContentDialogs({
  target,
  workspaceId,
  headerTitle,
  contacts,
  activeContact,
  activeGroup,
  activeChannel,
  currentUserId,
  workspaceRoomId,
  nicknamesByUserId,
  groupMemberProfiles,
  groupSettingsOpen,
  onGroupSettingsOpenChange,
  dmSettingsOpen,
  onDmSettingsOpenChange,
  channelSettingsOpen,
  onChannelSettingsOpenChange,
  setTarget,
  dmBlockedByMe,
  dmBlockedMe,
  onBlockContact,
  onUnblockContact,
  blockingContact,
  unblockingContact,
  addMembersOpen,
  onAddMembersOpenChange,
  invitingMembers,
  onAddGroupMembers,
  leavingConversation,
  onLeaveGroup,
  onLeaveDm,
  onLeaveChannel,
  workspaceMembers,
  memberAvatarByUserId,
  workspaceSettingsOpen,
  onWorkspaceSettingsOpenChange,
  activeRoomId,
  canPinMessages,
  t,
  onMessageSearchOpenChange,
  onVoiceCall,
  voiceCallDisabled,
  onVideoCall,
  videoCallDisabled,
  createPollOpen,
  onCreatePollOpenChange,
  createReminderOpen,
  onCreateReminderOpenChange,
  createNoteOpen,
  onCreateNoteOpenChange,
  createPostOpen,
  onCreatePostOpenChange,
}: ChatPageContentDialogsProps) {
  const messageMember = (member: ChatMemberMessageTarget) => {
    setTarget({
      kind: "dm",
      contact: {
        user_id: member.user_id,
        email: member.email,
        display_name: member.display_name.trim() || member.email,
      },
    });
    onWorkspaceSettingsOpenChange(false);
    onGroupSettingsOpenChange(false);
    onChannelSettingsOpenChange(false);
  };
  return (
    <>
      {activeRoomId ? (
        <ChatCreatePollDialog
          open={createPollOpen}
          onOpenChange={onCreatePollOpenChange}
          workspaceId={workspaceId}
          roomId={activeRoomId}
          canPinToTop={canPinMessages}
        />
      ) : null}
      {activeRoomId ? (
        <ChatCreateReminderDialog
          open={createReminderOpen}
          onOpenChange={onCreateReminderOpenChange}
          workspaceId={workspaceId}
          roomId={activeRoomId}
        />
      ) : null}
      {activeRoomId ? (
        <ChatCreateNoteDialog
          open={createNoteOpen}
          onOpenChange={onCreateNoteOpenChange}
          workspaceId={workspaceId}
          roomId={activeRoomId}
          canPinToTop={canPinMessages}
        />
      ) : null}
      {activeRoomId ? (
        <ChatCreatePostDialog
          open={createPostOpen}
          onOpenChange={onCreatePostOpenChange}
          workspaceId={workspaceId}
          roomId={activeRoomId}
          canPinToTop={canPinMessages}
        />
      ) : null}
      {target.kind === "workspace" && workspaceRoomId ? (
        <WorkspaceSettingsSheet
          open={workspaceSettingsOpen}
          onOpenChange={onWorkspaceSettingsOpenChange}
          workspaceId={workspaceId}
          roomId={workspaceRoomId}
          title={headerTitle}
          workspaceMembers={workspaceMembers}
          currentUserId={currentUserId}
          youLabel={t("chat.you")}
          onOpenSearch={() => onMessageSearchOpenChange(true)}
          onMessage={messageMember}
        />
      ) : null}
      {target.kind === "group" && activeGroup ? (
        <>
          <GroupSettingsSheet
            open={groupSettingsOpen}
            onOpenChange={onGroupSettingsOpenChange}
            workspaceId={workspaceId}
            group={activeGroup}
            currentUserId={currentUserId}
            youLabel={t("chat.you")}
            memberProfiles={groupMemberProfiles}
            memberAvatarByUserId={memberAvatarByUserId}
            nicknamesByUserId={nicknamesByUserId}
            onAddMembers={() => onAddMembersOpenChange(true)}
            leaving={leavingConversation}
            leaveDisabled={!activeRoomId}
            onLeave={onLeaveGroup}
            onOpenSearch={() => onMessageSearchOpenChange(true)}
            onMessage={messageMember}
          />
          <AddGroupMembersDialog
            open={addMembersOpen}
            onOpenChange={onAddMembersOpenChange}
            workspaceId={workspaceId}
            group={activeGroup}
            currentUserId={currentUserId}
            contacts={contacts}
            inviting={invitingMembers}
            onInvite={onAddGroupMembers}
          />
        </>
      ) : null}
      {target.kind === "dm" && activeContact ? (
        <DmSettingsSheet
          open={dmSettingsOpen}
          onOpenChange={onDmSettingsOpenChange}
          workspaceId={workspaceId}
          roomId={activeRoomId}
          currentUserId={currentUserId}
          nicknamesByUserId={nicknamesByUserId}
          contact={
            contacts.find((entry) => entry.user_id === activeContact.user_id) ?? activeContact
          }
          youLabel={t("chat.you")}
          leaving={leavingConversation}
          leaveDisabled={!activeRoomId}
          onLeave={onLeaveDm}
          blockedByMe={dmBlockedByMe}
          blockedMe={dmBlockedMe}
          onBlock={onBlockContact}
          onUnblock={onUnblockContact}
          blocking={blockingContact}
          unblocking={unblockingContact}
          memberAvatarByUserId={memberAvatarByUserId}
          onOpenSearch={() => onMessageSearchOpenChange(true)}
          onVoiceCall={onVoiceCall}
          voiceCallDisabled={voiceCallDisabled}
          onVideoCall={onVideoCall}
          videoCallDisabled={videoCallDisabled}
        />
      ) : null}
      {activeChannel ? (
        <>
          <ChannelSettingsSheet
            open={channelSettingsOpen}
            onOpenChange={onChannelSettingsOpenChange}
            workspaceId={workspaceId}
            channel={activeChannel}
            currentUserId={currentUserId}
            youLabel={t("chat.you")}
            memberAvatarByUserId={memberAvatarByUserId}
            onArchived={() => setTarget({ kind: "workspace" })}
            onAddMembers={
              activeChannel.is_default ? undefined : () => onAddMembersOpenChange(true)
            }
            onLeave={activeChannel.is_default ? undefined : onLeaveChannel}
            leaving={leavingConversation}
            leaveDisabled={!activeRoomId}
            onOpenSearch={() => onMessageSearchOpenChange(true)}
            onMessage={messageMember}
          />
          {!activeChannel.is_default ? (
            <AddGroupMembersDialog
              open={addMembersOpen}
              onOpenChange={onAddMembersOpenChange}
              workspaceId={workspaceId}
              group={{
                id: activeChannel.id,
                name: activeChannel.name,
                room_id: activeChannel.id,
                // The channel's roster, already loaded for the open room.
                member_user_ids: Object.keys(groupMemberProfiles),
              }}
              currentUserId={currentUserId}
              contacts={contacts}
              inviting={invitingMembers}
              onInvite={onAddGroupMembers}
              variant="channel"
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
