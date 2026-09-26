"use client";

import { Bell, BellOff, Pin, Search, Settings, StickyNote, Tag, UserPlus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { displayLabelForChatContact, resolveChatNicknameForUser } from "@uniwork/core/chat/contacts-store";
import {
  useChatRoomMembers,
  useChatRooms,
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
import { ChatRoomMemberActions } from "./chat-room-member-actions";
import {
  ChatMemberListError,
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
import { lookupMemberAvatarUrl, type MemberAvatarUrlMap } from "./chat-member-avatar";
import { initialOf } from "./chat-initials";
import { useRoomMemberModeration } from "./use-room-member-moderation";

type MemberProfile = {
  user_id: string;
  display_name: string;
  email: string;
};

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
  onOpenSearch,
  memberAvatarByUserId = {},
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  group: GroupChat;
  currentUserId: string;
  youLabel: string;
  memberProfiles: Record<string, MemberProfile>;
  memberAvatarByUserId?: MemberAvatarUrlMap;
  nicknamesByUserId?: Record<string, string>;
  onAddMembers: () => void;
  onOpenSearch?: () => void;
  onLeave: () => void | Promise<void>;
  leaving?: boolean;
  leaveDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const {
    data: chatMembers = [],
    isPending: membersPending,
    isError: membersError,
    refetch: refetchMembers,
  } = useChatRoomMembers(workspaceId, group.room_id, open);
  const manageId = useId();
  const { data: rooms = [] } = useChatRooms(workspaceId);
  const roomRecord = useMemo(
    () => rooms.find((room) => room.id === group.room_id),
    [group.room_id, rooms],
  );
  const { notificationsMuted, pinned, onToggleMute, onTogglePin } = useChatRoomPreferences(group.room_id);
  const currentMember = useCurrentMember(workspaceId);
  const moderation = useRoomMemberModeration({ workspaceId, roomId: group.room_id });
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} closeLabel={t("common.close")} className="flex w-full flex-col p-0 sm:max-w-md">
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
              onClick={() => setManageOpen((value) => !value)}
              active={manageOpen}
              controls={manageId}
            />
          </ChatSettingsQuickActions>

          {manageOpen ? (
            <ChatGroupManageSection
              id={manageId}
              workspaceId={workspaceId}
              roomId={group.room_id}
              permissions={roomRecord?.member_permissions}
              canManage={isModerator}
            />
          ) : null}

          <ChatSettingsCollapsibleSection
            title={t("chat.settings_group_members")}
            summary={
              membersPending || membersError ? undefined : t("chat.group_member_count", { count: members.length })
            }
            open={membersOpen}
            onOpenChange={setMembersOpen}
            flush
          >
            {membersPending ? (
              <ChatMemberListSkeleton label={t("chat.members_loading")} />
            ) : membersError ? (
              <ChatMemberListError onRetry={() => void refetchMembers()} />
            ) : (
              <ul>
                {members.map((member) => (
                  <ChatMemberRow
                    key={member.key}
                    avatar={
                      <ActorAvatar
                        name={member.label}
                        initials={initialOf(member.label)}
                        avatarUrl={lookupMemberAvatarUrl(memberAvatarByUserId, member.key)}
                        size="lg"
                      />
                    }
                    name={member.label}
                    detail={
                      member.label !== member.legalLabel
                        ? t("chat.nickname_legal_name", { name: member.legalLabel })
                        : member.chat.role === "admin"
                          ? t("chat.room_role_admin")
                          : member.chat.send_restricted
                            ? t("chat.room_role_muted")
                            : member.email
                    }
                    actions={
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={t("chat.nickname_action_for", { name: member.label })}
                          title={t("chat.nickname_action")}
                          onClick={() => setNicknameTarget({ userId: member.key, label: member.legalLabel })}
                        >
                          <Tag aria-hidden />
                        </Button>
                        {!member.isSelf && isModerator ? (
                          <ChatRoomMemberActions
                            label={member.label}
                            canPromote={canPromoteChatMember(member.chat, isModerator)}
                            canDemote={canDemoteChatMember(member.chat, currentUserId, isModerator)}
                            canMute={canMuteChatMember(member.chat, isModerator)}
                            canUnmute={canUnmuteChatMember(member.chat, isModerator)}
                            canKick={isModerator && member.chat.role === "member"}
                            busy={moderation.busyUserId === member.key}
                            onPromote={() => moderation.promote(member.key)}
                            onDemote={() => moderation.demote(member.key)}
                            onMute={() => moderation.mute(member.key)}
                            onUnmute={() => moderation.unmute(member.key)}
                            onKick={() =>
                              moderation.requestRemove(
                                member.key,
                                member.label,
                                t("chat.group_kick_confirm", { name: member.label }),
                              )
                            }
                          />
                        ) : null}
                      </>
                    }
                  />
                ))}
              </ul>
            )}
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

          <div className="px-4 py-4">
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
        {moderation.confirmDialog}
      </SheetContent>
    </Sheet>
  );
}
