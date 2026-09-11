"use client";

import { AddGroupMembersDialog } from "./add-group-members-dialog";
import { ChannelSettingsSheet } from "./channel-settings-sheet";
import { ChatCreatePollDialog } from "./chat-create-poll-dialog";
import { ChatCreateReminderDialog } from "./chat-create-reminder-dialog";
import { ChatCreateNoteDialog } from "./chat-create-note-dialog";
import { ChatCreatePostDialog } from "./chat-create-post-dialog";
import { DmSettingsSheet } from "./dm-settings-sheet";
import { GroupSettingsSheet } from "./group-settings-sheet";
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
  | "workHubEnabled"
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
  | "workspaceSettingsOpen"
  | "onWorkspaceSettingsOpenChange"
  | "activeRoomId"
  | "canPinMessages"
  | "t"
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
  workHubEnabled,
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
  workspaceSettingsOpen,
  onWorkspaceSettingsOpenChange,
  activeRoomId,
  canPinMessages,
  t,
  createPollOpen,
  onCreatePollOpenChange,
  createReminderOpen,
  onCreateReminderOpenChange,
  createNoteOpen,
  onCreateNoteOpenChange,
  createPostOpen,
  onCreatePostOpenChange,
}: ChatPageContentDialogsProps) {
  return (
    <>
      {activeRoomId ? (
        <ChatCreatePollDialog
          open={createPollOpen}
          onOpenChange={onCreatePollOpenChange}
          workspaceId={workspaceId}
          roomId={activeRoomId}
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
            nicknamesByUserId={nicknamesByUserId}
            onAddMembers={() => onAddMembersOpenChange(true)}
            leaving={leavingConversation}
            leaveDisabled={!activeRoomId}
            onLeave={onLeaveGroup}
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
        />
      ) : null}
      {workHubEnabled && activeChannel ? (
        <>
          <ChannelSettingsSheet
            open={channelSettingsOpen}
            onOpenChange={onChannelSettingsOpenChange}
            workspaceId={workspaceId}
            channel={activeChannel}
            currentUserId={currentUserId}
            youLabel={t("chat.you")}
            onArchived={() => setTarget({ kind: "workspace" })}
            onAddMembers={
              activeChannel.is_default ? undefined : () => onAddMembersOpenChange(true)
            }
            onLeave={activeChannel.is_default ? undefined : onLeaveChannel}
            leaving={leavingConversation}
            leaveDisabled={!activeRoomId}
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
                member_user_ids: activeChannel.member_user_ids,
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
