"use client";

import { Hash, MessageSquare } from "lucide-react";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageState } from "../layout/collection-page";
import { AddGroupMembersDialog } from "./add-group-members-dialog";
import { ChatComposer } from "./chat-composer";
import type { ChatMessage } from "./chat-messages";
import { ChatConversationHeader } from "./chat-conversation-header";
import { DmChatToolbar, DmSettingsSheet } from "./dm-settings-sheet";
import { GroupChatToolbar, GroupSettingsSheet } from "./group-settings-sheet";
import type { ChatSidebarTarget } from "./chat-sidebar";
import { ChatSidebar } from "./chat-sidebar";
import type { ChatNameContextEntry, GroupMemberProfile } from "./chat-page-utils";
import { NativeChatMessagePanel } from "./native-chat-message-panel";

export function ChatPageContent({
  target,
  setTarget,
  currentUserId,
  headerTitle,
  contacts,
  groups,
  activeContact,
  activeGroup,
  workspaceId,
  messageRefreshKey,
  activeRoomId,
  showLoading,
  connectError,
  isWorkspaceError,
  onRefetchWorkspace,
  workspaceRoomId,
  unreadByRoomId,
  unreadBadgesReady,
  nameContext,
  replyTo,
  onReplyToChange,
  draft,
  onDraftChange,
  onSend,
  groupSettingsOpen,
  onGroupSettingsOpenChange,
  dmSettingsOpen,
  onDmSettingsOpenChange,
  dmBlocked,
  dmBlockedByMe,
  dmBlockedMe,
  onBlockContact,
  onUnblockContact,
  blockingContact,
  unblockingContact,
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
  typingLabel,
  onVoiceCall,
  voiceCallDisabled,
  t,
}: {
  target: ChatSidebarTarget;
  setTarget: React.Dispatch<React.SetStateAction<ChatSidebarTarget>>;
  currentUserId: string;
  headerTitle: string;
  contacts: ChatContact[];
  groups: GroupChat[];
  activeContact: ChatContact | null;
  activeGroup: GroupChat | null;
  workspaceId: string;
  messageRefreshKey?: number;
  activeRoomId: string | null;
  showLoading: boolean;
  connectError: string | null;
  isWorkspaceError: boolean;
  onRefetchWorkspace: () => void;
  workspaceRoomId: string | null;
  unreadByRoomId: Record<string, number>;
  unreadBadgesReady: boolean;
  nameContext: ChatNameContextEntry[];
  replyTo: ChatMessage | null;
  onReplyToChange: React.Dispatch<React.SetStateAction<ChatMessage | null>>;
  draft: string;
  onDraftChange: React.Dispatch<React.SetStateAction<string>>;
  onSend: () => void;
  groupSettingsOpen: boolean;
  onGroupSettingsOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  dmSettingsOpen: boolean;
  onDmSettingsOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  dmBlocked: boolean;
  dmBlockedByMe: boolean;
  dmBlockedMe: boolean;
  onBlockContact: () => void;
  onUnblockContact: () => void;
  blockingContact: boolean;
  unblockingContact: boolean;
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
  typingLabel: string | null;
  onVoiceCall: () => void;
  voiceCallDisabled: boolean;
  t: (key: string, options?: Record<string, string | number>) => string;
}) {
  return (
    <>
      {target.kind === "group" && activeGroup ? (
        <>
          <GroupSettingsSheet
            open={groupSettingsOpen}
            onOpenChange={onGroupSettingsOpenChange}
            group={activeGroup}
            currentUserId={currentUserId}
            youLabel={t("chat.you")}
            memberProfiles={groupMemberProfiles}
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

      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 px-4 pb-4 pt-2 md:px-6">
        <div
          className={cn(
            "flex min-h-0 w-full flex-1 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm",
            "lg:grid lg:grid-cols-[280px_minmax(0,1fr)]",
          )}
        >
          <ChatSidebar
            currentUserId={currentUserId}
            workspaceId={workspaceId}
            target={target}
            onTargetChange={setTarget}
            contacts={contacts}
            groups={groups}
            onCreateGroup={onCreateGroup}
            creatingGroup={creatingGroup}
            createGroupOpen={createGroupOpen}
            onCreateGroupOpenChange={onCreateGroupOpenChange}
            workspaceRoomId={workspaceRoomId}
            unreadByRoomId={unreadByRoomId}
            unreadBadgesReady={unreadBadgesReady}
            embedded
          />

          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-muted/15">
            {isWorkspaceError && target.kind === "workspace" ? (
              <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
                <p className="text-caption text-muted-foreground">{t("chat.room_load_failed")}</p>
                <Button type="button" variant="outline" size="sm" onClick={onRefetchWorkspace}>
                  {t("chat.retry")}
                </Button>
              </div>
            ) : null}
            {connectError && (target.kind === "dm" || target.kind === "group") ? (
              <p className="border-b border-border bg-surface px-4 py-2 text-caption text-muted-foreground">
                {connectError}
              </p>
            ) : null}
            {target.kind === "dm" && dmBlocked ? (
              <p className="border-b border-border bg-surface px-4 py-2 text-caption text-muted-foreground">
                {dmBlockedByMe ? t("chat.block_active_banner") : t("chat.blocked_me_banner")}
              </p>
            ) : null}

            {showLoading ? (
              <div className="flex flex-1 items-center justify-center p-6">
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
              </div>
            ) : activeRoomId ? (
              <>
                {target.kind === "workspace" ? (
                  <ChatConversationHeader
                    avatar={
                      <span className="flex size-10 items-center justify-center rounded-full bg-brand/10 text-brand">
                        <Hash className="size-5" aria-hidden />
                      </span>
                    }
                    title={headerTitle}
                    subtitle={t("chat.workspace_room_hint")}
                  />
                ) : null}
                {target.kind === "group" && activeGroup ? (
                  <GroupChatToolbar
                    title={headerTitle}
                    memberCount={activeGroup.member_user_ids.length + 1}
                    onOpenSettings={() => onGroupSettingsOpenChange(true)}
                    onVoiceCall={onVoiceCall}
                    voiceCallDisabled={voiceCallDisabled}
                  />
                ) : null}
                {target.kind === "dm" && activeContact ? (
                  <DmChatToolbar
                    contact={
                      contacts.find((entry) => entry.user_id === activeContact.user_id) ??
                      activeContact
                    }
                    onOpenSettings={() => onDmSettingsOpenChange(true)}
                    onVoiceCall={onVoiceCall}
                    voiceCallDisabled={voiceCallDisabled}
                  />
                ) : null}

                <NativeChatMessagePanel
                  workspaceId={workspaceId}
                  roomId={activeRoomId}
                  currentUserId={currentUserId}
                  nameContext={nameContext}
                  youLabel={t("chat.you")}
                  emptyLabel={
                    target.kind === "workspace"
                      ? t("chat.group_description")
                      : target.kind === "group"
                        ? t("chat.group_empty", { name: headerTitle })
                        : t("chat.dm_empty", {
                            name: displayLabelForChatContact(target.contact),
                          })
                  }
                  replyTo={replyTo}
                  onReplyToChange={onReplyToChange}
                  refreshKey={messageRefreshKey}
                  showSenderName={target.kind === "workspace" || target.kind === "group"}
                  embedded
                />

                <ChatComposer
                  draft={draft}
                  onDraftChange={onDraftChange}
                  onSend={onSend}
                  disabled={showLoading || !activeRoomId || dmBlocked}
                  placeholder={
                    dmBlocked
                      ? t("chat.block_composer_placeholder")
                      : t("chat.message_placeholder")
                  }
                  sendLabel={t("chat.send")}
                  typingLabel={typingLabel}
                />
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <span className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <MessageSquare className="size-8" aria-hidden />
                </span>
                <p className="text-body font-medium text-foreground">{t("chat.contacts_title")}</p>
                <p className="max-w-sm text-caption text-muted-foreground">{t("chat.contacts_hint")}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
