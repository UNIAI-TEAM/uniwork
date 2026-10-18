"use client";

import {
  Bell,
  BellOff,
  House,
  Pin,
  Search,
  Settings,
  StickyNote,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useChatRoomMembers,
  useChatRooms,
} from "@uniwork/core/chat";
import { useCurrentMember } from "@uniwork/core/permissions";
import type { Member } from "@uniwork/core/types/workspace";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import {
  ChatMemberListError,
  ChatMemberListSkeleton,
  ChatSettingsCollapsibleSection,
  ChatSettingsHeader,
  ChatSettingsHero,
  ChatSettingsMenuRow,
  ChatSettingsQuickAction,
  ChatSettingsQuickActions,
  ChatSettingsRoomMark,
  ChatSettingsSection,
} from "./chat-settings-ui";
import { CHAT_SHEET_CLASS } from "./chat-dialog-look";
import { ChatGroupManageSection } from "./chat-group-manage-section";
import { ChatRoomBulletinSheet } from "./chat-room-bulletin-sheet";
import { ChatRoomRenameDialog } from "./chat-room-rename-dialog";
import { useChatRoomPreferences } from "./use-chat-room-preferences";
import { useResolvedRoomPermissions } from "./use-resolved-room-permissions";
import type { ChatMemberMessageTarget } from "./chat-member-profile";
import { WorkspaceRoomMemberList } from "./workspace-room-member-list";
import { ChatRoomSharedTotals } from "./chat-room-shared-totals";

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
  onMessage,
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
  onMessage?: (member: ChatMemberMessageTarget) => void;
}) {
  const { t } = useTranslation();
  const {
    data: chatMembers = [],
    isPending: membersPending,
    isError: membersError,
    refetch: refetchMembers,
  } = useChatRoomMembers(workspaceId, roomId, open);
  const { data: rooms = [] } = useChatRooms(workspaceId);
  const roomRecord = useMemo(() => rooms.find((room) => room.id === roomId), [roomId, rooms]);
  const { notificationsMuted, pinned, onToggleMute, onTogglePin } = useChatRoomPreferences(workspaceId, roomId);
  const currentMember = useCurrentMember(workspaceId);
  const manageId = useId();
  // The canvas opens the sheet on its member list.
  const [membersOpen, setMembersOpen] = useState(true);
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} closeLabel={t("common.close")} className={CHAT_SHEET_CLASS}>
        <SheetHeader className="sr-only">
          <SheetTitle>{displayName}</SheetTitle>
          <SheetDescription>{t("chat.workspace_room_settings_description")}</SheetDescription>
        </SheetHeader>

        <ChatSettingsHeader title={t("chat.workspace_room_settings")} />

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* Blue, as the workspace room's row in the sidebar. */}
          <ChatSettingsHero
            mark={<ChatSettingsRoomMark icon={House} tint="blue" />}
            name={displayName}
            subtitle={
              membersPending || membersError
                ? undefined
                : t("chat.group_member_count", { count: chatMembers.length })
            }
            editAriaLabel={t("chat.settings_edit_name")}
            onEdit={isModerator ? () => setRenameOpen(true) : undefined}
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
              controls={manageId}
            />
          </ChatSettingsQuickActions>

          {manageOpen ? (
            <ChatGroupManageSection
              id={manageId}
              workspaceId={workspaceId}
              roomId={roomId}
              permissions={roomRecord?.member_permissions}
              canManage={isModerator}
            />
          ) : null}

          <ChatRoomSharedTotals workspaceId={workspaceId} roomId={roomId} open={open} />

          <ChatSettingsCollapsibleSection
            title={t("chat.workspace_members")}
            summary={
              membersPending || membersError ? undefined : t("chat.group_member_count", { count: chatMembers.length })
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
              <WorkspaceRoomMemberList
                workspaceId={workspaceId}
                roomId={roomId}
                members={chatMembers}
                workspaceMembers={workspaceMembers}
                currentUserId={currentUserId}
                youLabel={youLabel}
                isModerator={isModerator}
                onMessage={onMessage}
              />
            )}
            <p className="px-5 pt-1.5 pb-1.5 text-caption text-pretty text-muted-foreground">
              {t("chat.workspace_room_moderation_hint")}
            </p>
          </ChatSettingsCollapsibleSection>

          <ChatSettingsSection className="py-1">
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
          </ChatSettingsSection>
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
