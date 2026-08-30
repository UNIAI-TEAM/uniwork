"use client";

import { MessageSquare } from "lucide-react";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { Button } from "@uniwork/ui/components/ui/button";
import type { MatrixClient } from "matrix-js-sdk";
import { CollectionPageState } from "../layout/collection-page";
import { AddGroupMembersDialog } from "./add-group-members-dialog";
import { ChatComposer } from "./chat-composer";
import { ChatMessagePanel } from "./chat-message-panel";
import type { ChatMessage } from "./chat-messages";
import { DmChatToolbar, DmSettingsSheet } from "./dm-settings-sheet";
import { GroupChatToolbar, GroupSettingsSheet } from "./group-settings-sheet";
import { readGroupRoomMembers } from "./matrix-group";
import type { ChatSidebarTarget } from "./chat-sidebar";
import { ChatSidebar } from "./chat-sidebar";
import type { ChatNameContextEntry, GroupMemberProfile } from "./chat-page-utils";

export function ChatPageContent({
  target,
  setTarget,
  currentUserId,
  headerTitle,
  contacts,
  activeContact,
  activeGroup,
  matrixClient,
  matrixSessionUserId,
  activeRoomId,
  showLoading,
  connectError,
  isWorkspaceError,
  onRefetchWorkspace,
  workspaceRoomId,
  unreadByRoomId,
  unreadBadgesReady,
  nameContext,
  dmReaderMatrixUserId,
  replyTo,
  onReplyToChange,
  draft,
  onDraftChange,
  onSend,
  typingLabel,
  groupSettingsOpen,
  onGroupSettingsOpenChange,
  dmSettingsOpen,
  onDmSettingsOpenChange,
  addMembersOpen,
  onAddMembersOpenChange,
  createGroupOpen,
  onCreateGroupOpenChange,
  creatingGroup,
  onCreateGroup,
  invitingMembers,
  onAddGroupMembers,
  leavingConversation,
  onLeaveGroup,
  onLeaveDm,
  groupMemberProfiles,
  onVoiceCall,
  voiceCallDisabled,
  t,
}: {
  target: ChatSidebarTarget;
  setTarget: React.Dispatch<React.SetStateAction<ChatSidebarTarget>>;
  currentUserId: string;
  headerTitle: string;
  contacts: ChatContact[];
  activeContact: ChatContact | null;
  activeGroup: GroupChat | null;
  matrixClient: MatrixClient | null;
  matrixSessionUserId: string;
  activeRoomId: string | null;
  showLoading: boolean;
  connectError: string | null;
  isWorkspaceError: boolean;
  onRefetchWorkspace: () => void;
  workspaceRoomId: string | null;
  unreadByRoomId: Record<string, number>;
  unreadBadgesReady: boolean;
  nameContext: ChatNameContextEntry[];
  dmReaderMatrixUserId: string | null;
  replyTo: ChatMessage | null;
  onReplyToChange: React.Dispatch<React.SetStateAction<ChatMessage | null>>;
  draft: string;
  onDraftChange: React.Dispatch<React.SetStateAction<string>>;
  onSend: () => void;
  typingLabel: string | null;
  groupSettingsOpen: boolean;
  onGroupSettingsOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  dmSettingsOpen: boolean;
  onDmSettingsOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  addMembersOpen: boolean;
  onAddMembersOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  createGroupOpen: boolean;
  onCreateGroupOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  creatingGroup: boolean;
  onCreateGroup: (members: ChatContact[], name: string) => void;
  invitingMembers: boolean;
  onAddGroupMembers: (members: ChatContact[]) => void;
  leavingConversation: boolean;
  onLeaveGroup: () => void;
  onLeaveDm: () => void;
  groupMemberProfiles: Record<string, GroupMemberProfile>;
  onVoiceCall: () => void;
  voiceCallDisabled: boolean;
  t: (key: string, options?: Record<string, string>) => string;
}) {
  return (
    <>
      {target.kind === "group" && activeGroup ? (
        <>
          <GroupSettingsSheet
            open={groupSettingsOpen}
            onOpenChange={onGroupSettingsOpenChange}
            group={activeGroup}
            client={matrixClient}
            roomId={activeRoomId}
            myMatrixUserId={matrixSessionUserId}
            youLabel={t("chat.you")}
            memberProfiles={groupMemberProfiles}
            onAddMembers={() => onAddMembersOpenChange(true)}
            leaving={leavingConversation}
            onLeave={onLeaveGroup}
          />
          <AddGroupMembersDialog
            open={addMembersOpen}
            onOpenChange={onAddMembersOpenChange}
            group={activeGroup}
            currentUserId={currentUserId}
            inviting={invitingMembers}
            onInvite={onAddGroupMembers}
          />
        </>
      ) : null}
      {target.kind === "dm" && activeContact ? (
        <DmSettingsSheet
          open={dmSettingsOpen}
          onOpenChange={onDmSettingsOpenChange}
          contact={
            contacts.find((entry) => entry.user_id === activeContact.user_id) ?? activeContact
          }
          youLabel={t("chat.you")}
          leaving={leavingConversation}
          leaveDisabled={!matrixClient || !activeRoomId}
          onLeave={onLeaveDm}
        />
      ) : null}
      <div className="mx-auto grid h-full min-h-0 w-full max-w-5xl flex-1 gap-4 p-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <ChatSidebar
          currentUserId={currentUserId}
          target={target}
          onTargetChange={setTarget}
          onCreateGroup={onCreateGroup}
          creatingGroup={creatingGroup}
          createGroupOpen={createGroupOpen}
          onCreateGroupOpenChange={onCreateGroupOpenChange}
          workspaceRoomId={workspaceRoomId}
          unreadByRoomId={unreadByRoomId}
          unreadBadgesReady={unreadBadgesReady}
        />

        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          {isWorkspaceError && target.kind === "workspace" ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2">
              <p className="text-caption text-muted-foreground">{t("chat.room_load_failed")}</p>
              <Button type="button" variant="outline" size="sm" onClick={onRefetchWorkspace}>
                {t("chat.retry")}
              </Button>
            </div>
          ) : null}
          {connectError && (target.kind === "dm" || target.kind === "group") ? (
            <p className="rounded-md border border-border bg-surface px-3 py-2 text-caption text-muted-foreground">
              {connectError}
            </p>
          ) : null}
          {showLoading ? (
            <CollectionPageState
              icon={MessageSquare}
              title={t("chat.loading")}
              description={
                target.kind === "workspace"
                  ? t("chat.group_description")
                  : target.kind === "group"
                    ? t("chat.group_loading")
                    : t("chat.dm_hint")
              }
            />
          ) : matrixClient && activeRoomId ? (
            <>
              {target.kind === "group" ? (
                <GroupChatToolbar
                  title={headerTitle}
                  memberCount={readGroupRoomMembers(matrixClient, activeRoomId).length}
                  onOpenSettings={() => onGroupSettingsOpenChange(true)}
                />
              ) : null}
              {target.kind === "dm" && activeContact ? (
                <DmChatToolbar
                  contact={
                    contacts.find((entry) => entry.user_id === activeContact.user_id) ?? activeContact
                  }
                  onOpenSettings={() => onDmSettingsOpenChange(true)}
                  onVoiceCall={onVoiceCall}
                  voiceCallDisabled={voiceCallDisabled}
                />
              ) : null}
              <ChatMessagePanel
                client={matrixClient}
                roomId={activeRoomId}
                currentUserId={currentUserId}
                myMatrixUserId={matrixSessionUserId}
                readReceiptReaderId={dmReaderMatrixUserId}
                nameContext={nameContext}
                youLabel={t("chat.you")}
                replyTo={replyTo}
                onReplyToChange={onReplyToChange}
                emptyLabel={
                  target.kind === "workspace"
                    ? t("chat.group_description")
                    : target.kind === "group"
                      ? t("chat.group_empty", { name: headerTitle })
                      : t("chat.dm_empty", {
                          name: displayLabelForChatContact(target.contact),
                        })
                }
              />
            </>
          ) : matrixClient && target.kind === "workspace" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface p-4">
              <p className="text-body text-muted-foreground">{t("chat.group_description")}</p>
            </div>
          ) : null}
          <ChatComposer
            draft={draft}
            onDraftChange={onDraftChange}
            onSend={onSend}
            disabled={(showLoading && !activeRoomId) || !matrixClient}
            placeholder={t("chat.message_placeholder")}
            sendLabel={t("chat.send")}
            typingLabel={typingLabel}
          />
        </div>
      </div>
    </>
  );
}
