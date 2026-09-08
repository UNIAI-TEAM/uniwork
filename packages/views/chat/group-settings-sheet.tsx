"use client";

import type { ReactNode } from "react";
import { Bell, BellOff, Pin, Settings, Tag, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { displayLabelForChatContact, resolveChatNicknameForUser } from "@uniwork/core/chat/contacts-store";
import {
  useChatRoomMembers,
  useChatRooms,
  useRemoveChatRoomMember,
  useUpdateChatRoomMember,
} from "@uniwork/core/chat";
import { useCurrentMember } from "@uniwork/core/permissions";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { LeaveConversationSection } from "./leave-conversation-section";
import { ChatConversationHeader } from "./chat-conversation-header";
import { ChatRoomMemberActions } from "./chat-room-member-actions";
import {
  ChatSettingsBulletinEntry,
  ChatSettingsCollapsibleSection,
  ChatSettingsQuickAction,
  ChatSettingsQuickActions,
  ChatSettingsTitleRow,
} from "./chat-settings-ui";
import { ChatGroupManageSection } from "./chat-group-manage-section";
import { ChatRoomBulletinSheet } from "./chat-room-bulletin-sheet";
import { ChatSetNicknameDialog } from "./chat-set-nickname-dialog";
import { ChatRoomRenameDialog } from "./chat-room-rename-dialog";
import { useChatRoomPreferences } from "./use-chat-room-preferences";
import { useResolvedRoomPermissions } from "./use-resolved-room-permissions";
import {
  canDemoteChatMember,
  canMuteChatMember,
  canPromoteChatMember,
  canUnmuteChatMember,
} from "./chat-room-moderation-utils";

type MemberProfile = {
  user_id: string;
  display_name: string;
  email: string;
};

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function GroupSettingsSheet({
  open,
  onOpenChange,
  workspaceId,
  group,
  currentUserId,
  youLabel,
  memberProfiles,
  nicknamesByUserId = {},
  onAddMembers,
  onLeave,
  leaving,
  leaveDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  group: GroupChat;
  currentUserId: string;
  youLabel: string;
  memberProfiles: Record<string, MemberProfile>;
  nicknamesByUserId?: Record<string, string>;
  onAddMembers: () => void;
  onLeave: () => void | Promise<void>;
  leaving?: boolean;
  leaveDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const { data: chatMembers = [] } = useChatRoomMembers(workspaceId, group.room_id, open);
  const { data: rooms = [] } = useChatRooms(workspaceId);
  const roomRecord = useMemo(
    () => rooms.find((room) => room.id === group.room_id),
    [group.room_id, rooms],
  );
  const { notificationsMuted, pinned, onToggleMute, onTogglePin } = useChatRoomPreferences(group.room_id);
  const currentMember = useCurrentMember(workspaceId);
  const updateMember = useUpdateChatRoomMember(workspaceId);
  const removeMember = useRemoveChatRoomMember(workspaceId);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [bulletinOpen, setBulletinOpen] = useState(false);
  const [nicknameTarget, setNicknameTarget] = useState<{ userId: string; label: string } | null>(null);

  const displayName = roomRecord?.name?.trim() || group.name;
  const roomPermissions = useResolvedRoomPermissions({
    room: roomRecord,
    members: chatMembers,
    currentUserId,
    wsRole: currentMember.role,
  });
  const isModerator = roomPermissions.isModerator;

  const members = useMemo(() => {
    const byId = new Map(chatMembers.map((member) => [member.user_id, member]));
    const ordered = chatMembers.map((member) => {
      const isSelf = member.user_id === currentUserId;
      const profile = memberProfiles[member.user_id];
      const legalLabel = isSelf
        ? memberProfiles[currentUserId]?.display_name?.trim() ||
          member.display_name?.trim() ||
          youLabel
        : displayLabelForChatContact({
            user_id: member.user_id,
            display_name: member.display_name?.trim() || profile?.display_name?.trim() || member.user_id,
            email: member.email || profile?.email || "",
          });
      const nickname = resolveChatNicknameForUser(nicknamesByUserId, member.user_id);
      const label = isSelf ? nickname || youLabel : nickname || legalLabel;
      return {
        key: member.user_id,
        label,
        legalLabel,
        email: member.email || profile?.email,
        isSelf,
        chat: member,
      };
    });
    if (!byId.has(currentUserId)) {
      ordered.unshift({
        key: currentUserId,
        label: youLabel,
        legalLabel: youLabel,
        email: undefined,
        isSelf: true,
        chat: {
          user_id: currentUserId,
          role: "member",
          send_restricted: false,
          email: "",
          display_name: youLabel,
        },
      });
    }
    return ordered;
  }, [chatMembers, currentUserId, youLabel, memberProfiles, nicknamesByUserId]);

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
          <SheetDescription>{t("chat.group_settings_description")}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <ChatSettingsTitleRow
            title={displayName}
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
              icon={UserPlus}
              label={t("chat.settings_add_member")}
              onClick={() => {
                onOpenChange(false);
                onAddMembers();
              }}
            />
            <ChatSettingsQuickAction
              icon={Settings}
              label={t("chat.settings_manage_group")}
              onClick={() => setManageOpen(true)}
              active={manageOpen}
            />
          </ChatSettingsQuickActions>

          {manageOpen ? (
            <ChatGroupManageSection
              workspaceId={workspaceId}
              roomId={group.room_id}
              permissions={roomRecord?.member_permissions}
              canManage={isModerator}
            />
          ) : null}

          <ChatSettingsCollapsibleSection
            title={t("chat.settings_group_members")}
            summary={t("chat.group_member_count", { count: members.length })}
            open={membersOpen}
            onOpenChange={setMembersOpen}
          >
            <ul className="space-y-2">
              {members.map((member) => (
                <li
                  key={member.key}
                  className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
                >
                  <ActorAvatar name={member.label} initials={initialOf(member.label)} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-foreground">{member.label}</p>
                    <p className="truncate text-caption text-muted-foreground">
                      {!member.isSelf && member.label !== member.legalLabel ? (
                        t("chat.nickname_legal_name", { name: member.legalLabel })
                      ) : member.isSelf && member.label !== member.legalLabel ? (
                        t("chat.nickname_legal_name", { name: member.legalLabel })
                      ) : member.chat.role === "admin"
                          ? t("chat.room_role_admin")
                          : member.chat.send_restricted
                            ? t("chat.room_role_muted")
                            : member.email}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-8 shrink-0 text-muted-foreground"
                    aria-label={t("chat.nickname_action")}
                    onClick={() =>
                      setNicknameTarget({ userId: member.key, label: member.legalLabel })
                    }
                  >
                    <Tag className="size-4" aria-hidden />
                  </Button>
                  {!member.isSelf && isModerator ? (
                    <ChatRoomMemberActions
                      label={member.label}
                      canPromote={canPromoteChatMember(member.chat, isModerator)}
                      canDemote={canDemoteChatMember(member.chat, currentUserId, isModerator)}
                      canMute={canMuteChatMember(member.chat, isModerator)}
                      canUnmute={canUnmuteChatMember(member.chat, isModerator)}
                      canKick={isModerator && member.chat.role === "member"}
                      busy={busyUserId === member.key}
                      onPromote={() =>
                        runMemberAction(member.key, () =>
                          updateMember.mutateAsync({
                            roomId: group.room_id,
                            userId: member.key,
                            role: "admin",
                          }),
                        )
                      }
                      onDemote={() =>
                        runMemberAction(member.key, () =>
                          updateMember.mutateAsync({
                            roomId: group.room_id,
                            userId: member.key,
                            role: "member",
                          }),
                        )
                      }
                      onMute={() =>
                        runMemberAction(member.key, () =>
                          updateMember.mutateAsync({
                            roomId: group.room_id,
                            userId: member.key,
                            send_restricted: true,
                          }),
                        )
                      }
                      onUnmute={() =>
                        runMemberAction(member.key, () =>
                          updateMember.mutateAsync({
                            roomId: group.room_id,
                            userId: member.key,
                            send_restricted: false,
                          }),
                        )
                      }
                      onKick={() =>
                        runMemberAction(
                          member.key,
                          () =>
                            removeMember.mutateAsync({
                              roomId: group.room_id,
                              userId: member.key,
                            }),
                          t("chat.group_kick_confirm", { name: member.label }),
                        )
                      }
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </ChatSettingsCollapsibleSection>

          <ChatSettingsBulletinEntry
            label={t("chat.settings_notes_pins_polls")}
            onClick={() => setBulletinOpen(true)}
          />

          <div className="px-4 pb-4">
            <LeaveConversationSection
              variant="group"
              disabled={leaveDisabled}
              leaving={leaving}
              onLeave={onLeave}
            />
          </div>
        </div>

        {renameOpen ? (
          <ChatRoomRenameDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            workspaceId={workspaceId}
            roomId={group.room_id}
            currentName={displayName}
          />
        ) : null}
        {bulletinOpen ? (
          <ChatRoomBulletinSheet
            open={bulletinOpen}
            onOpenChange={setBulletinOpen}
            workspaceId={workspaceId}
            roomId={group.room_id}
            title={t("chat.settings_group_bulletin")}
            canCreateNotes={roomPermissions.canCreateNotes}
            canCreatePolls={roomPermissions.canCreatePolls}
            canPinMessages={roomPermissions.canPinContent}
          />
        ) : null}
        {nicknameTarget ? (
          <ChatSetNicknameDialog
            open
            onOpenChange={(next) => {
              if (!next) setNicknameTarget(null);
            }}
            workspaceId={workspaceId}
            targetUserId={nicknameTarget.userId}
            targetLabel={nicknameTarget.label}
            currentNickname={resolveChatNicknameForUser(nicknamesByUserId, nicknameTarget.userId) ?? ""}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function ChatConversationToolbar({
  avatar,
  title,
  subtitle,
  backAriaLabel,
  onBack,
  settingsAriaLabel,
  onOpenSettings,
  onOpenSearch,
  voiceCallAriaLabel,
  onVoiceCall,
  voiceCallDisabled,
  videoCallAriaLabel,
  onVideoCall,
  videoCallDisabled,
}: {
  avatar: ReactNode;
  title: string;
  subtitle: string;
  backAriaLabel?: string;
  onBack?: () => void;
  settingsAriaLabel: string;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  voiceCallAriaLabel?: string;
  onVoiceCall?: () => void;
  voiceCallDisabled?: boolean;
  videoCallAriaLabel?: string;
  onVideoCall?: () => void;
  videoCallDisabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ChatConversationHeader
      avatar={avatar}
      title={title}
      subtitle={subtitle}
      backAriaLabel={backAriaLabel}
      onBack={onBack}
      settingsAriaLabel={settingsAriaLabel}
      onOpenSettings={onOpenSettings}
      searchAriaLabel={t("chat.search_messages")}
      onOpenSearch={onOpenSearch}
      voiceCallAriaLabel={voiceCallAriaLabel}
      onVoiceCall={onVoiceCall}
      voiceCallDisabled={voiceCallDisabled}
      videoCallAriaLabel={videoCallAriaLabel}
      onVideoCall={onVideoCall}
      videoCallDisabled={videoCallDisabled}
    />
  );
}

export function GroupChatToolbar({
  title,
  memberCount,
  backAriaLabel,
  onBack,
  onOpenSettings,
  onOpenSearch,
  onVoiceCall,
  voiceCallDisabled,
  onVideoCall,
  videoCallDisabled,
}: {
  title: string;
  memberCount: number;
  backAriaLabel?: string;
  onBack?: () => void;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  onVoiceCall?: () => void;
  voiceCallDisabled?: boolean;
  onVideoCall?: () => void;
  videoCallDisabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <ChatConversationToolbar
      avatar={
        <ActorAvatar name={title} initials={initialOf(title)} size="xl" />
      }
      title={title}
      subtitle={t("chat.group_member_count", { count: memberCount })}
      backAriaLabel={backAriaLabel}
      onBack={onBack}
      settingsAriaLabel={t("chat.group_settings")}
      onOpenSettings={onOpenSettings}
      onOpenSearch={onOpenSearch}
      voiceCallAriaLabel={t("chat.voice_call_start")}
      onVoiceCall={onVoiceCall}
      voiceCallDisabled={voiceCallDisabled}
      videoCallAriaLabel={t("chat.video_call_start")}
      onVideoCall={onVideoCall}
      videoCallDisabled={videoCallDisabled}
    />
  );
}
