"use client";

import {
  Bell,
  BellOff,
  ChevronLeft,
  Hash,
  PanelLeft,
  PanelLeftClose,
  Pin,
  Search,
  Settings,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useChatRoomMembers,
  useChatRooms,
  useRemoveChatRoomMember,
  useUpdateChatRoomMember,
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
  ChatSettingsBulletinEntry,
  ChatSettingsCollapsibleSection,
  ChatSettingsQuickAction,
  ChatSettingsQuickActionsDm,
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

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function WorkspaceSettingsSheet({
  open,
  onOpenChange,
  workspaceId,
  roomId,
  title,
  workspaceMembers,
  currentUserId,
  youLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  roomId: string;
  title: string;
  workspaceMembers: Member[];
  currentUserId: string;
  youLabel: string;
}) {
  const { t } = useTranslation();
  const { data: chatMembers = [] } = useChatRoomMembers(workspaceId, roomId, open);
  const { data: rooms = [] } = useChatRooms(workspaceId);
  const roomRecord = useMemo(() => rooms.find((room) => room.id === roomId), [roomId, rooms]);
  const { notificationsMuted, pinned, onToggleMute, onTogglePin } = useChatRoomPreferences(roomId);
  const currentMember = useCurrentMember(workspaceId);
  const { decideRemove } = useWorkspacePermissions(workspaceId);
  const updateMember = useUpdateChatRoomMember(workspaceId);
  const removeMember = useRemoveChatRoomMember(workspaceId);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [bulletinOpen, setBulletinOpen] = useState(false);

  const displayName = roomRecord?.name?.trim() || title;
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

  const runMemberAction = (
    userId: string,
    action: () => Promise<unknown>,
    confirmMessage?: string,
  ) => {
    if (busyUserId) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusyUserId(userId);
    void action().finally(() => {
      setBusyUserId(null);
    });
  };

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
            leading={
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                <Hash className="size-5" aria-hidden />
              </span>
            }
            editAriaLabel={t("chat.settings_edit_name")}
            onEdit={roomPermissions.canChangeProfile ? () => setRenameOpen(true) : undefined}
          />

          <ChatSettingsQuickActionsDm>
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
              onClick={() => setManageOpen(true)}
              active={manageOpen}
            />
          </ChatSettingsQuickActionsDm>

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
            summary={t("chat.group_member_count", { count: chatMembers.length })}
            open={membersOpen}
            onOpenChange={setMembersOpen}
          >
            <ul className="space-y-2">
              {chatMembers.map((member) => {
                const isSelf = member.user_id === currentUserId;
                const label = isSelf
                  ? youLabel
                  : member.display_name?.trim() || member.email || member.user_id;
                const wsMember = wsRoleByUserId.get(member.user_id);
                const subtitle =
                  member.role === "admin"
                    ? t("chat.room_role_admin")
                    : member.send_restricted
                      ? t("chat.room_role_muted")
                      : wsMember?.role === "owner"
                        ? t("chat.workspace_role_owner")
                        : member.email;

                return (
                  <li
                    key={member.user_id}
                    className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <ActorAvatar name={label} initials={initialOf(label)} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium text-foreground">{label}</p>
                      <p className="truncate text-caption text-muted-foreground">{subtitle}</p>
                    </div>
                    {!isSelf && isModerator ? (
                      <ChatRoomMemberActions
                        label={label}
                        canPromote={canPromoteChatMember(member, isModerator)}
                        canDemote={canDemoteChatMember(member, currentUserId, isModerator)}
                        canMute={canMuteChatMember(member, isModerator)}
                        canUnmute={canUnmuteChatMember(member, isModerator)}
                        canKick={
                          wsMember ? decideRemove(wsMember).allowed && member.role !== "admin" : false
                        }
                        busy={busyUserId === member.user_id}
                        onPromote={() =>
                          runMemberAction(member.user_id, () =>
                            updateMember.mutateAsync({
                              roomId,
                              userId: member.user_id,
                              role: "admin",
                            }),
                          )
                        }
                        onDemote={() =>
                          runMemberAction(member.user_id, () =>
                            updateMember.mutateAsync({
                              roomId,
                              userId: member.user_id,
                              role: "member",
                            }),
                          )
                        }
                        onMute={() =>
                          runMemberAction(member.user_id, () =>
                            updateMember.mutateAsync({
                              roomId,
                              userId: member.user_id,
                              send_restricted: true,
                            }),
                          )
                        }
                        onUnmute={() =>
                          runMemberAction(member.user_id, () =>
                            updateMember.mutateAsync({
                              roomId,
                              userId: member.user_id,
                              send_restricted: false,
                            }),
                          )
                        }
                        onKick={() =>
                          runMemberAction(
                            member.user_id,
                            () =>
                              removeMember.mutateAsync({
                                roomId,
                                userId: member.user_id,
                              }),
                            t("workspace.removeConfirm", { name: label }),
                          )
                        }
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="text-caption text-muted-foreground">{t("chat.workspace_room_moderation_hint")}</p>
          </ChatSettingsCollapsibleSection>

          <ChatSettingsBulletinEntry
            label={t("chat.settings_notes_pins_polls")}
            onClick={() => setBulletinOpen(true)}
          />
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
  onOpenSearch,
}: {
  title: string;
  memberCount: number;
  backAriaLabel?: string;
  onBack?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          aria-label={backAriaLabel}
          onClick={onBack}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Button>
      ) : null}
      {/* Narrow screens swap list and thread with the back control above, so
          the collapse toggle is a desktop-only affordance. */}
      {onToggleSidebar ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="hidden size-10 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground lg:inline-flex"
          aria-label={
            sidebarCollapsed ? t("chat.show_conversations") : t("chat.hide_conversations")
          }
          aria-expanded={!sidebarCollapsed}
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="size-5" aria-hidden />
          ) : (
            <PanelLeftClose className="size-5" aria-hidden />
          )}
        </Button>
      ) : null}
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Hash className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-body font-semibold text-foreground">{title}</h1>
        <p className="truncate text-caption text-muted-foreground">
          {t("chat.group_member_count", { count: memberCount })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onOpenSearch ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("chat.search_messages")}
            onClick={onOpenSearch}
          >
            <Search className="size-5" aria-hidden />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("chat.workspace_room_settings")}
          onClick={onOpenSettings}
        >
          <Settings className="size-5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
