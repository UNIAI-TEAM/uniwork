"use client";

import {
  Bell,
  BellOff,
  Hash,
  Home,
  Pin,
  Search,
  Settings,
  StickyNote,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useChatRoomMembers,
  useChatRooms,
} from "@uniwork/core/chat";
import { useWorkspacePermissions, useCurrentMember } from "@uniwork/core/permissions";
import type { Member } from "@uniwork/core/types/workspace";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { ChatRoomMemberActions } from "./chat-room-member-actions";
import {
  ChatMemberListSkeleton,
  ChatMemberRow,
  ChatSettingsCollapsibleSection,
  ChatSettingsMenuRow,
  ChatSettingsQuickAction,
  ChatSettingsQuickActions,
  ChatSettingsTitleRow,
} from "./chat-settings-ui";
import { ChatGroupManageSection } from "./chat-group-manage-section";
import { ChatRoomBulletinSheet } from "./chat-room-bulletin-sheet";
import { ChatRoomRenameDialog } from "./chat-room-rename-dialog";
import { useChatRoomPreferences } from "./use-chat-room-preferences";
import { useResolvedRoomPermissions } from "./use-resolved-room-permissions";
import {
  canDemoteChatMember,
  canMuteChatMember,
  canPromoteChatMember,
  canUnmuteChatMember,
} from "./chat-room-moderation-utils";
import { initialOf } from "./chat-initials";
import { useRoomMemberModeration } from "./use-room-member-moderation";
import { ChatConversationToolbar } from "./chat-conversation-toolbar";
import { ChatRoomMark } from "./chat-room-mark";

export function WorkspaceSettingsSheet({
  open,
  onOpenChange,
  workspaceId,
  roomId,
  title,
  workspaceMembers,
  currentUserId,
  youLabel,
  onOpenSearch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  roomId: string;
  title: string;
  workspaceMembers: Member[];
  currentUserId: string;
  youLabel: string;
  onOpenSearch?: () => void;
}) {
  const { t } = useTranslation();
  const { data: chatMembers = [], isPending: membersPending } = useChatRoomMembers(workspaceId, roomId, open);
  const { data: rooms = [] } = useChatRooms(workspaceId);
  const roomRecord = useMemo(() => rooms.find((room) => room.id === roomId), [roomId, rooms]);
  const { notificationsMuted, pinned, onToggleMute, onTogglePin } = useChatRoomPreferences(roomId);
  const currentMember = useCurrentMember(workspaceId);
  const { decideRemove } = useWorkspacePermissions(workspaceId);
  const moderation = useRoomMemberModeration({ workspaceId, roomId });
  const [membersOpen, setMembersOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [bulletinOpen, setBulletinOpen] = useState(false);

  // The page resolves the room's shown name (generic until renamed); the
  // sheet repeats it so list, header and settings never disagree.
  const displayName = title;
  const roomPermissions = useResolvedRoomPermissions({
    room: roomRecord,
    members: chatMembers,
    currentUserId,
    wsRole: currentMember.role,
  });
  const isModerator = roomPermissions.isModerator;

  const wsRoleByUserId = useMemo(
    () => new Map(workspaceMembers.map((member) => [member.user_id, member])),
    [workspaceMembers],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="sr-only">
          <SheetTitle>{displayName}</SheetTitle>
          <SheetDescription>{t("chat.workspace_room_settings_description")}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <ChatSettingsTitleRow
            title={displayName}
            leading={<ChatRoomMark icon={Home} size="header" />}
            editAriaLabel={t("chat.settings_edit_name")}
            onEdit={roomPermissions.canChangeProfile ? () => setRenameOpen(true) : undefined}
          />

          <ChatSettingsQuickActions>
            <ChatSettingsQuickAction
              icon={notificationsMuted ? BellOff : Bell}
              label={t("chat.settings_mute_notifications")}
              onClick={onToggleMute}
              active={notificationsMuted}
            />
            <ChatSettingsQuickAction
              icon={Pin}
              label={t("chat.settings_pin_conversation")}
              onClick={onTogglePin}
              active={pinned}
            />
            <ChatSettingsQuickAction
              icon={Settings}
              label={t("chat.settings_manage_room")}
              onClick={() => setManageOpen((value) => !value)}
              active={manageOpen}
            />
          </ChatSettingsQuickActions>

          {manageOpen ? (
            <ChatGroupManageSection
              workspaceId={workspaceId}
              roomId={roomId}
              permissions={roomRecord?.member_permissions}
              canManage={isModerator}
            />
          ) : null}

          <ChatSettingsCollapsibleSection
            title={t("chat.workspace_members")}
            summary={membersPending ? undefined : t("chat.group_member_count", { count: chatMembers.length })}
            open={membersOpen}
            onOpenChange={setMembersOpen}
            flush
          >
            {membersPending ? (
              <ChatMemberListSkeleton label={t("chat.members_loading")} />
            ) : (
              <ul>
                {chatMembers.map((member) => {
                  const isSelf = member.user_id === currentUserId;
                  const label = isSelf
                    ? youLabel
                    : member.display_name?.trim() || member.email || member.user_id;
                  const wsMember = wsRoleByUserId.get(member.user_id);
                  const detail =
                    member.role === "admin"
                      ? t("chat.room_role_admin")
                      : member.send_restricted
                        ? t("chat.room_role_muted")
                        : wsMember?.role === "owner"
                          ? t("chat.workspace_role_owner")
                          : member.email;
                  return (
                    <ChatMemberRow
                      key={member.user_id}
                      avatar={<ActorAvatar name={label} initials={initialOf(label)} size="lg" />}
                      name={label}
                      detail={detail}
                      actions={
                        !isSelf && isModerator ? (
                          <ChatRoomMemberActions
                            label={label}
                            canPromote={canPromoteChatMember(member, isModerator)}
                            canDemote={canDemoteChatMember(member, currentUserId, isModerator)}
                            canMute={canMuteChatMember(member, isModerator)}
                            canUnmute={canUnmuteChatMember(member, isModerator)}
                            canKick={wsMember ? decideRemove(wsMember).allowed && member.role !== "admin" : false}
                            busy={moderation.busyUserId === member.user_id}
                            onPromote={() => moderation.promote(member.user_id)}
                            onDemote={() => moderation.demote(member.user_id)}
                            onMute={() => moderation.mute(member.user_id)}
                            onUnmute={() => moderation.unmute(member.user_id)}
                            onKick={() =>
                              moderation.requestRemove(
                                member.user_id,
                                label,
                                t("workspace.removeConfirm", { name: label }),
                              )
                            }
                          />
                        ) : null
                      }
                    />
                  );
                })}
              </ul>
            )}
            <p className="px-4 pt-1 text-caption text-muted-foreground">{t("chat.workspace_room_moderation_hint")}</p>
          </ChatSettingsCollapsibleSection>

          <section className="border-b border-border py-1">
            <ChatSettingsMenuRow
              icon={StickyNote}
              label={t("chat.settings_notes_pins_polls")}
              onClick={() => setBulletinOpen(true)}
            />
            {onOpenSearch ? (
              <ChatSettingsMenuRow
                icon={Search}
                label={t("chat.search_messages")}
                onClick={() => {
                  onOpenChange(false);
                  onOpenSearch();
                }}
              />
            ) : null}
          </section>
        </div>

        {renameOpen ? (
          <ChatRoomRenameDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            workspaceId={workspaceId}
            roomId={roomId}
            currentName={displayName}
          />
        ) : null}
        {bulletinOpen ? (
          <ChatRoomBulletinSheet
            open={bulletinOpen}
            onOpenChange={setBulletinOpen}
            workspaceId={workspaceId}
            roomId={roomId}
            title={t("chat.settings_group_bulletin")}
            canCreateNotes={roomPermissions.canCreateNotes}
            canCreatePolls={roomPermissions.canCreatePolls}
            canPinMessages={roomPermissions.canPinContent}
          />
        ) : null}
        {moderation.confirmDialog}
      </SheetContent>
    </Sheet>
  );
}

export function WorkspaceChatToolbar({
  title,
  memberCount,
  backAriaLabel,
  onBack,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSettings,
  onCatchUp,
  catchUpDisabled,
}: {
  title: string;
  memberCount: number;
  backAriaLabel?: string;
  onBack?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenSettings: () => void;
  onCatchUp?: () => void;
  catchUpDisabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ChatConversationToolbar
      avatar={<ChatRoomMark icon={Home} />}
      title={title}
      subtitle={t("chat.group_member_count", { count: memberCount })}
      backAriaLabel={backAriaLabel}
      onBack={onBack}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={onToggleSidebar}
      settingsAriaLabel={t("chat.workspace_room_settings")}
      onOpenSettings={onOpenSettings}
      catchUpAriaLabel={t("chat.ai.catch_up")}
      onCatchUp={onCatchUp}
      catchUpDisabled={catchUpDisabled}
    />
  );
}
