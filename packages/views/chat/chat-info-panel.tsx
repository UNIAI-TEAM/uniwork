"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  BellOff,
  Disc3,
  House,
  Lock,
  Phone,
  Search,
  Settings,
  Sparkles,
  UserPlus,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { useChatRoomMembers, useChatRooms } from "@uniwork/core/chat";
import { displayLabelForChatContact, type ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { useCurrentMember } from "@uniwork/core/permissions";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { identityTint } from "../people/identity-tint";
import { chatMembersLine } from "./chat-conversation-toolbar";
import { initialsOf } from "./chat-initials";
import { ChatInfoDescription } from "./chat-info-panel-description";
import { ChatRoomFace } from "./chat-info-panel-mark";
import { ChatInfoMedia } from "./chat-info-panel-media";
import { ChatInfoMembers } from "./chat-info-panel-members";
import { ChatInfoMoreRow, ChatInfoTile } from "./chat-info-panel-parts";
import { ChatInfoTasks } from "./chat-info-panel-tasks";
import { useOnlineCount } from "./chat-info-panel-utils";
import { lookupMemberAvatarUrl, type MemberAvatarUrlMap } from "./chat-member-avatar";
import { chatPersonFaceClass } from "./chat-person-card";
import { ChatPresenceAvatar } from "./chat-presence-avatar";
import type { ChatSidebarTarget } from "./chat-sidebar-types";
import { chatSettingsIconButtonClass } from "./chat-settings-ui";
import { useChatRoomPreferences } from "./use-chat-room-preferences";
import { useResolvedRoomPermissions } from "./use-resolved-room-permissions";

export type ChatInfoPanelProps = {
  target: ChatSidebarTarget;
  workspaceId: string;
  roomId: string;
  /** The room's display name, as the header shows it. */
  title: string;
  currentUserId: string;
  activeContact: ChatContact | null;
  activeGroup: GroupChat | null;
  activeChannel: ChatRoomRecord | null;
  workspaceMemberIds: readonly string[];
  channelMemberIds: readonly string[];
  memberAvatarByUserId: MemberAvatarUrlMap;
  nicknamesByUserId: Record<string, string>;
  /** Docked as the page's third column; otherwise it slides over the conversation. */
  docked: boolean;
  onClose: () => void;
  onSearch: () => void;
  onVoiceCall: () => void;
  voiceCallDisabled: boolean;
  onVideoCall: () => void;
  videoCallDisabled: boolean;
  onAddMembers?: () => void;
  onOpenSettings: () => void;
  onCatchUp?: () => void;
  catchUpDisabled?: boolean;
  onOpenRecordings?: () => void;
  onJumpToMessage: (messageId: string) => void;
};

const NO_IDS: readonly string[] = [];

/**
 * The open room at a glance, beside the conversation (canvas "Thông tin
 * nhóm"): who or what it is, four quick actions, its description, the tasks
 * made from it, what it shared and who is in it. Editing and moderation stay
 * in the settings sheet, one row away at the bottom.
 */
export function ChatInfoPanel(props: ChatInfoPanelProps) {
  const { target, workspaceId, roomId, currentUserId, docked, onClose } = props;
  const { t } = useTranslation();
  const kind = target.kind;
  const { data: rooms } = useChatRooms(workspaceId);
  const room = useMemo(() => rooms?.find((entry) => entry.id === roomId), [roomId, rooms]);
  const { data: members = [] } = useChatRoomMembers(workspaceId, roomId, kind !== "dm");
  const wsRole = useCurrentMember(workspaceId).role;
  const permissions = useResolvedRoomPermissions({ room, members, currentUserId, wsRole });
  const { notificationsMuted, onToggleMute } = useChatRoomPreferences(workspaceId, roomId);
  const peopleIds =
    kind === "workspace"
      ? props.workspaceMemberIds
      : kind === "group"
        ? (props.activeGroup?.member_user_ids ?? NO_IDS)
        : kind === "channel"
          ? props.channelMemberIds
          : props.activeContact
            ? [props.activeContact.user_id]
            : NO_IDS;
  const online = useOnlineCount(peopleIds);

  // Sliding over the conversation, the panel takes focus and Escape gives it back.
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (docked) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [docked, onClose]);

  const heading = t(`chat.info_panel.title_${kind}`);
  const memberTotal =
    kind === "workspace"
      ? props.workspaceMemberIds.length
      : kind === "group"
        ? (props.activeGroup?.member_user_ids.length ?? 0) + 1
        : (props.activeChannel?.member_count ?? members.length);
  const settingsLabel =
    kind === "group"
      ? t("chat.group_settings")
      : kind === "channel"
        ? t("chat.channel.settings_title")
        : kind === "workspace"
          ? t("chat.workspace_room_settings")
          : t("chat.dm_settings");

  const tiles: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; pressed?: boolean }[] = [
    {
      icon: notificationsMuted ? BellOff : Bell,
      label: t("chat.info_panel.tile_mute"),
      onClick: onToggleMute,
      pressed: notificationsMuted,
    },
    { icon: Search, label: t("chat.info_panel.tile_search"), onClick: props.onSearch },
  ];
  if (kind === "workspace") {
    if (props.onCatchUp) {
      tiles.push({
        icon: Sparkles,
        label: t("chat.info_panel.tile_catch_up"),
        onClick: props.onCatchUp,
        disabled: props.catchUpDisabled,
      });
    }
  } else {
    tiles.push({
      icon: Phone,
      label: t("chat.info_panel.tile_call"),
      onClick: props.onVoiceCall,
      disabled: props.voiceCallDisabled,
    });
  }
  if (kind === "dm") {
    tiles.push({
      icon: Video,
      label: t("chat.info_panel.tile_video"),
      onClick: props.onVideoCall,
      disabled: props.videoCallDisabled,
    });
  } else if (props.onAddMembers) {
    tiles.push({ icon: UserPlus, label: t("chat.info_panel.tile_add"), onClick: props.onAddMembers });
  } else {
    tiles.push({ icon: Settings, label: t("chat.info_panel.tile_settings"), onClick: props.onOpenSettings });
  }

  return (
    <aside
      aria-label={heading}
      className={cn(
        "flex min-h-0 flex-col overflow-y-auto overscroll-contain border-l border-border bg-surface",
        docked ? "w-75 shrink-0" : "absolute inset-y-0 right-0 z-30 w-full shadow-floating sm:max-w-85",
      )}
    >
      <div className="flex h-16 shrink-0 items-center border-b border-border pr-2 pl-5">
        <h2 className="min-w-0 flex-1 truncate font-display text-title-sm font-bold text-foreground">{heading}</h2>
        <Button
          ref={closeRef}
          type="button"
          variant="ghost"
          size="icon"
          className={chatSettingsIconButtonClass}
          aria-label={t("common.close")}
          onClick={onClose}
        >
          <X className="size-5" aria-hidden />
        </Button>
      </div>

      <ChatInfoHero {...props} room={room} online={online} memberTotal={memberTotal} />

      <div className="grid grid-cols-4 gap-2 px-4 pb-4">
        {tiles.map((tile) => (
          <ChatInfoTile key={tile.label} {...tile} />
        ))}
      </div>

      {kind === "group" ? (
        <ChatInfoDescription
          workspaceId={workspaceId}
          roomId={roomId}
          topic={room?.topic ?? ""}
          canEdit={permissions.canChangeProfile}
        />
      ) : kind === "channel" && props.activeChannel ? (
        <ChatInfoDescription
          workspaceId={workspaceId}
          roomId={roomId}
          topic={props.activeChannel.topic ?? ""}
          canEdit={permissions.isModerator}
          onEdit={props.onOpenSettings}
        />
      ) : null}

      <ChatInfoTasks workspaceId={workspaceId} roomId={roomId} />
      <ChatInfoMedia workspaceId={workspaceId} roomId={roomId} onJumpToMessage={props.onJumpToMessage} />

      {kind !== "dm" ? (
        <ChatInfoMembers
          members={members}
          total={memberTotal}
          currentUserId={currentUserId}
          memberAvatarByUserId={props.memberAvatarByUserId}
          nicknamesByUserId={props.nicknamesByUserId}
          onViewAll={props.onOpenSettings}
        />
      ) : null}

      <section className="border-t-8 border-muted py-1 pb-3">
        {props.onCatchUp && kind !== "workspace" ? (
          <ChatInfoMoreRow
            icon={Sparkles}
            label={t("chat.ai.catch_up")}
            onClick={props.onCatchUp}
            disabled={props.catchUpDisabled}
          />
        ) : null}
        {props.onOpenRecordings ? (
          <ChatInfoMoreRow icon={Disc3} label={t("chat.voice_recordings_open")} onClick={props.onOpenRecordings} />
        ) : null}
        <ChatInfoMoreRow icon={Settings} label={settingsLabel} onClick={props.onOpenSettings} />
      </section>
    </aside>
  );
}

/** Mark, name and who is here: a room's members and how many are online, a person's presence. */
function ChatInfoHero({
  target,
  title,
  room,
  online,
  memberTotal,
  activeContact,
  activeGroup,
  activeChannel,
  memberAvatarByUserId,
  nicknamesByUserId,
}: ChatInfoPanelProps & { room?: ChatRoomRecord; online: number; memberTotal: number }) {
  const { t } = useTranslation();
  let mark: ReactNode;
  let name = title;
  let line: ReactNode;
  let detail: string | undefined;
  if (target.kind === "dm" && activeContact) {
    name = displayLabelForChatContact(activeContact, nicknamesByUserId);
    mark = (
      <ChatPresenceAvatar
        name={name}
        initials={initialsOf(name)}
        avatarUrl={lookupMemberAvatarUrl(memberAvatarByUserId, activeContact.user_id)}
        size="fluid"
        avatarClassName={cn("size-21 text-display-sm", chatPersonFaceClass(activeContact.user_id))}
        online={online > 0}
      />
    );
    line =
      online > 0 ? <span className="text-success">{t("chat.presence_online")}</span> : t("chat.dm_direct_message");
    detail = activeContact.email || undefined;
  } else {
    const face =
      target.kind === "workspace"
        ? { icon: House, tint: "blue" as const }
        : target.kind === "channel"
          ? {
              ...(activeChannel?.visibility === "private" ? { icon: Lock } : { text: "#" }),
              tint: identityTint(activeChannel?.id ?? title),
            }
          : { tint: identityTint(activeGroup?.id ?? room?.id ?? title) };
    mark = (
      <ChatRoomFace
        name={title}
        size="panel"
        imageUrl={target.kind === "group" ? (room?.avatar_url ?? activeGroup?.avatar_url) : undefined}
        {...face}
      />
    );
    line = `${t(`chat.info_panel.kind_${target.kind}`)} · ${chatMembersLine(t, memberTotal, online)}`;
  }
  return (
    <div className="flex flex-col items-center gap-1 px-5 pt-6 pb-4 text-center">
      {mark}
      <p className="mt-2.5 max-w-full truncate font-display text-title font-bold text-foreground">{name}</p>
      <p className="text-label text-muted-foreground tabular-nums">{line}</p>
      {detail ? <p className="max-w-full truncate text-label text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
