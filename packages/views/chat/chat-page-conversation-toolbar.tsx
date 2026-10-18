"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { Hash, House, Lock, Send, UserPlus, Users } from "lucide-react";
import { IconTile, tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { AppLink } from "../navigation";
import { paths } from "@uniwork/core/paths";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { WorkspaceIcon } from "../layout/workspace-icon";
import { workspaceTint } from "../layout/workspace-rail";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { ChatConversationIntro } from "./chat-conversation-intro";
import { initialsOf } from "./chat-initials";
import { identityTint } from "../people/identity-tint";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import type { ChatSidebarTarget } from "./chat-sidebar";
import { lookupMemberAvatarUrl, type MemberAvatarUrlMap } from "./chat-member-avatar";
import { ChatConversationToolbar, chatMembersLine, type ChatToolbarCommonProps } from "./chat-conversation-toolbar";
import { ChatRoomFace } from "./chat-info-panel-mark";
import { useOnlineCount } from "./chat-info-panel-utils";
import { ChatPresenceAvatar } from "./chat-presence-avatar";
import { chatPersonFaceClass } from "./chat-person-card";

/**
 * The open room's header: its mark, name and who is here (typing first), then
 * search, calls and the info panel toggle — the actions each kind of room has
 * on the canvas. Everything else about the room lives in the info panel.
 */
export function ChatPageConversationToolbar({
  target,
  headerTitle,
  contacts,
  activeContact,
  activeGroup,
  activeChannel,
  workspaceMemberIds,
  channelMemberIds,
  roomWorkspaceId,
  nicknamesByUserId,
  memberAvatarByUserId,
  onSearch,
  onCatchUp,
  ...rest
}: ChatToolbarCommonProps & {
  target: ChatSidebarTarget;
  headerTitle: string;
  contacts: ChatContact[];
  activeContact: ChatContact | null;
  activeGroup: GroupChat | null;
  activeChannel: ChatRoomRecord | null;
  workspaceMemberIds: readonly string[];
  /** The open channel's roster (loaded for its mentions); a channel record carries only a count. */
  channelMemberIds: readonly string[];
  /** The workspace the room lives in; DMs and groups follow the person into every workspace. */
  roomWorkspaceId?: string;
  nicknamesByUserId: Record<string, string>;
  memberAvatarByUserId: MemberAvatarUrlMap;
}) {
  const { t } = useTranslation();
  const common = { ...rest, titleAddon: <ChatRoomWorkspaceChip workspaceId={roomWorkspaceId} /> };
  const peopleIds =
    target.kind === "workspace"
      ? workspaceMemberIds
      : target.kind === "group"
        ? (activeGroup?.member_user_ids ?? [])
        : target.kind === "channel"
          ? channelMemberIds
          : activeContact
            ? [activeContact.user_id]
            : [];
  const online = useOnlineCount(peopleIds);
  // While someone types, the line reads "Minh đang nhập… · 12 thành viên" (canvas): the online count steps aside.
  const shownOnline = common.typingLabel ? 0 : online;

  if (target.kind === "workspace") {
    return (
      <ChatConversationToolbar
        {...common}
        avatar={<ChatRoomFace name={headerTitle} icon={House} tint="blue" size="header" />}
        title={headerTitle}
        subtitle={chatMembersLine(t, workspaceMemberIds.length, shownOnline)}
        panelAriaLabel={t("chat.info_panel.title_workspace")}
        onSearch={onSearch}
        onCatchUp={onCatchUp}
        onVoiceCall={undefined}
        onVideoCall={undefined}
      />
    );
  }
  if (target.kind === "group" && activeGroup) {
    return (
      <ChatConversationToolbar
        {...common}
        avatar={
          <ChatRoomFace name={headerTitle} tint={identityTint(activeGroup.id)} imageUrl={activeGroup.avatar_url} size="header" />
        }
        title={headerTitle}
        subtitle={chatMembersLine(t, activeGroup.member_user_ids.length + 1, shownOnline)}
        panelAriaLabel={t("chat.info_panel.title_group")}
        onSearch={onSearch}
      />
    );
  }
  if (target.kind === "channel" && activeChannel) {
    return (
      <ChatConversationToolbar
        {...common}
        avatar={
          <ChatRoomFace
            name={headerTitle}
            {...(activeChannel.visibility === "private" ? { icon: Lock } : { text: "#" })}
            tint={identityTint(activeChannel.id)}
            size="header"
          />
        }
        title={headerTitle}
        subtitle={chatMembersLine(t, activeChannel.member_count, shownOnline)}
        panelAriaLabel={t("chat.info_panel.title_channel")}
        onSearch={onSearch}
      />
    );
  }
  if (target.kind === "dm" && activeContact) {
    const contact = contacts.find((entry) => entry.user_id === activeContact.user_id) ?? activeContact;
    const label = displayLabelForChatContact(contact, nicknamesByUserId);
    return (
      <ChatConversationToolbar
        {...common}
        avatar={
          <ChatPresenceAvatar
            name={label}
            initials={initialsOf(label)}
            avatarUrl={lookupMemberAvatarUrl(memberAvatarByUserId, contact.user_id)}
            size="fluid"
            avatarClassName={cn("size-10.5 text-body-lg", chatPersonFaceClass(contact.user_id))}
            online={online > 0}
          />
        }
        title={label}
        subtitle={
          online > 0 ? <span className="text-success">{t("chat.presence_online")}</span> : t("chat.dm_direct_message")
        }
        panelAriaLabel={t("chat.info_panel.title_dm")}
      />
    );
  }
  return null;
}

/**
 * "TT Truyền thông": the chip beside a room's name when it lives in another
 * workspace than the one open (a DM or group seen from a second workspace).
 */
function ChatRoomWorkspaceChip({ workspaceId }: { workspaceId?: string }) {
  const open = useOptionalWorkspace()?.workspace;
  const { data: workspaces = [] } = useWorkspaces(Boolean(workspaceId && open && workspaceId !== open.id));
  const home = workspaceId && open && workspaceId !== open.id ? workspaces.find((w) => w.id === workspaceId) : undefined;
  if (!home) return null;
  return (
    <span className="inline-flex h-5.5 shrink-0 items-center gap-1.25 rounded-full bg-muted pr-2 pl-0.75 text-caption font-semibold text-foreground">
      <WorkspaceIcon
        workspace={home}
        className={cn("size-4 rounded-[5px] text-micro font-bold", tintSolidClass[workspaceTint(workspaces, home.id)])}
      />
      {home.name}
    </span>
  );
}

export function chatPageEmptyLabel(
  t: (key: string, options?: Record<string, string | number>) => string,
  target: ChatSidebarTarget,
  headerTitle: string,
  nicknamesByUserId: Record<string, string>,
): string {
  if (target.kind === "workspace") return t("chat.group_description");
  if (target.kind === "group") return t("chat.group_empty", { name: headerTitle });
  if (target.kind === "channel") return t("chat.channel.empty_thread", { name: headerTitle });
  if (target.kind === "dm") {
    return t("chat.dm_empty", {
      name: displayLabelForChatContact(target.contact, nicknamesByUserId),
    });
  }
  return t("chat.empty_description");
}

/** What the DM intro's "Gửi lời chào" sends, as a plain message. */
export const CHAT_WAVE = "👋";

/** The canvas intro buttons: 34px pills. */
const INTRO_PILL = "h-8.5 rounded-full px-3.5";

/** The intro block for the open conversation, by kind of room. */
export function ChatPageConversationIntro({
  target,
  headerTitle,
  activeChannel,
  nicknamesByUserId,
  t,
  onViewMembers,
  onAddMembers,
  workspaceMemberCount,
  memberAvatarByUserId,
  onWave,
}: {
  target: ChatSidebarTarget;
  headerTitle: string;
  activeChannel: ChatRoomRecord | null;
  nicknamesByUserId: Record<string, string>;
  t: (key: string, options?: Record<string, string | number>) => string;
  onViewMembers: () => void;
  onAddMembers: () => void;
  /** Members of the workspace — the workspace room's audience. */
  workspaceMemberCount: number;
  memberAvatarByUserId: MemberAvatarUrlMap;
  /** A DM's first move: sends a waving hand (canvas "Gửi lời chào"). */
  onWave?: () => void;
}) {
  // Workspace settings › Members is where invitations are sent.
  const workspace = useOptionalWorkspace()?.workspace;
  const inviteHref = workspace
    ? `${paths.workspace(workspace.organization_slug, workspace.slug).settings()}?tab=members`
    : undefined;
  const tile = (icon: typeof House) => (
    <IconTile icon={icon} tone="brand" size="lg" className="size-14 rounded-2xl [&_svg]:size-7" />
  );
  if (target.kind === "workspace") {
    // Say what is true for this workspace today: alone, the room is a place
    // to invite people into; with others, it is where all of them already are.
    const alone = workspaceMemberCount <= 1;
    const invite = inviteHref ? (
      <AppLink
        href={inviteHref}
        className={buttonVariants({ variant: alone ? "default" : "brandSubtle", size: "sm", className: INTRO_PILL })}
      >
        <UserPlus aria-hidden />
        {alone ? t("chat.intro_invite_first") : t("chat.intro_invite_more")}
      </AppLink>
    ) : null;
    return (
      <ChatConversationIntro
        mark={tile(House)}
        title={t("chat.intro_workspace_title", { name: headerTitle })}
        description={
          alone
            ? t("chat.intro_workspace_description_alone")
            : t("chat.intro_workspace_description", { count: workspaceMemberCount })
        }
        actions={
          alone ? (
            invite
          ) : (
            <>
              <Button type="button" variant="secondary" size="sm" className={INTRO_PILL} onClick={onViewMembers}>
                <Users aria-hidden />
                {t("chat.intro_view_members")}
              </Button>
              {invite}
            </>
          )
        }
      />
    );
  }
  if (target.kind === "group") {
    return (
      <ChatConversationIntro
        mark={tile(Users)}
        title={t("chat.intro_group_title", { name: headerTitle })}
        description={t("chat.intro_group_description")}
        actions={
          <Button type="button" size="sm" className={INTRO_PILL} onClick={onAddMembers}>
            <UserPlus aria-hidden />
            {t("chat.settings_add_member")}
          </Button>
        }
      />
    );
  }
  if (target.kind === "channel") {
    const channel = activeChannel ?? target.channel;
    const topic = channel.topic?.trim();
    return (
      <ChatConversationIntro
        mark={tile(channel.visibility === "private" ? Lock : Hash)}
        title={t("chat.intro_channel_title", { name: headerTitle })}
        description={topic || t("chat.intro_channel_description")}
        actions={
          channel.is_default ? undefined : (
            <Button type="button" size="sm" className={INTRO_PILL} onClick={onAddMembers}>
              <UserPlus aria-hidden />
              {t("chat.settings_add_member")}
            </Button>
          )
        }
      />
    );
  }
  return (
    <ChatDmIntro
      contact={target.contact}
      name={displayLabelForChatContact(target.contact, nicknamesByUserId)}
      avatarUrl={lookupMemberAvatarUrl(memberAvatarByUserId, target.contact.user_id)}
      onWave={onWave}
    />
  );
}

/** A DM's beginning: the person (online dot included), who sees it, and a wave to break the ice. */
function ChatDmIntro({
  contact,
  name,
  avatarUrl,
  onWave,
}: {
  contact: ChatContact;
  name: string;
  avatarUrl?: string;
  onWave?: () => void;
}) {
  const { t } = useTranslation();
  const online = useOnlineCount([contact.user_id]) > 0;
  return (
    <ChatConversationIntro
      mark={
        <ChatPresenceAvatar
          name={name}
          initials={initialsOf(name)}
          avatarUrl={avatarUrl}
          size="fluid"
          avatarClassName={cn("size-18 text-title-lg", chatPersonFaceClass(contact.user_id))}
          online={online}
        />
      }
      title={t("chat.intro_dm_title", { name })}
      description={t("chat.intro_dm_description")}
      actions={
        onWave ? (
          <button
            type="button"
            className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl p-1 text-label font-semibold text-primary hover:underline"
            onClick={onWave}
          >
            <span aria-hidden className="flex size-18 items-center justify-center rounded-2xl bg-tint-yellow text-display-sm">
              {CHAT_WAVE}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Send className="size-4" aria-hidden />
              {t("chat.intro_dm_wave")}
            </span>
          </button>
        ) : undefined
      }
    />
  );
}
