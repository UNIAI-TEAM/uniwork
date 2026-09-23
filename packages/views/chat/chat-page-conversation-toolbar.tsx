"use client";

import { Hash, Home, Lock, UserPlus, Users } from "lucide-react";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { AppLink } from "../navigation";
import { paths } from "@uniwork/core/paths";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { moduleTone } from "../layout/module-tones";
import { ChatConversationIntro } from "./chat-conversation-intro";
import { initialOf } from "./chat-initials";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import type { ChatSidebarTarget } from "./chat-sidebar";
import { DmChatToolbar } from "./dm-settings-sheet";
import { GroupChatToolbar } from "./chat-conversation-toolbar";
import { WorkspaceChatToolbar } from "./workspace-settings-sheet";

/** Conversation header toolbar for the active chat target. */
export function ChatPageConversationToolbar({
  target,
  headerTitle,
  contacts,
  activeContact,
  activeGroup,
  activeChannel,
  workspaceMembersCount,
  nicknamesByUserId,
  backToListLabel,
  sidebarCollapsed,
  onBack,
  onToggleSidebar,
  onOpenWorkspaceSettings,
  onOpenGroupSettings,
  onOpenChannelSettings,
  onOpenDmSettings,
  onCatchUp,
  catchUpDisabled,
  onOpenRecordings,
  onVoiceCall,
  voiceCallDisabled,
  onVideoCall,
  videoCallDisabled,
  onSearch,
}: {
  target: ChatSidebarTarget;
  headerTitle: string;
  contacts: ChatContact[];
  activeContact: ChatContact | null;
  activeGroup: GroupChat | null;
  activeChannel: ChatRoomRecord | null;
  workspaceMembersCount: number;
  nicknamesByUserId: Record<string, string>;
  backToListLabel: string;
  sidebarCollapsed: boolean;
  onBack: () => void;
  onToggleSidebar: () => void;
  onOpenWorkspaceSettings: () => void;
  onOpenGroupSettings: () => void;
  onOpenChannelSettings: () => void;
  onOpenDmSettings: () => void;
  onCatchUp?: () => void;
  catchUpDisabled?: boolean;
  onOpenRecordings?: () => void;
  onVoiceCall: () => void;
  voiceCallDisabled: boolean;
  onVideoCall: () => void;
  videoCallDisabled: boolean;
  /** Opens message search; the group and channel headers carry it (DM and workspace have it in settings). */
  onSearch?: () => void;
}) {
  if (target.kind === "workspace") {
    return (
      <WorkspaceChatToolbar
        title={headerTitle}
        memberCount={workspaceMembersCount}
        backAriaLabel={backToListLabel}
        onBack={onBack}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onOpenSettings={onOpenWorkspaceSettings}
        onCatchUp={onCatchUp}
        catchUpDisabled={catchUpDisabled}
      />
    );
  }
  if (target.kind === "group" && activeGroup) {
    return (
      <GroupChatToolbar
        title={headerTitle}
        memberCount={activeGroup.member_user_ids.length + 1}
        backAriaLabel={backToListLabel}
        onBack={onBack}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onOpenSettings={onOpenGroupSettings}
        onCatchUp={onCatchUp}
        catchUpDisabled={catchUpDisabled}
        onOpenRecordings={onOpenRecordings}
        onVoiceCall={onVoiceCall}
        voiceCallDisabled={voiceCallDisabled}
        onVideoCall={onVideoCall}
        videoCallDisabled={videoCallDisabled}
        onSearch={onSearch}
      />
    );
  }
  if (target.kind === "channel" && activeChannel) {
    return (
      <GroupChatToolbar
        icon={activeChannel.visibility === "private" ? Lock : Hash}
        title={headerTitle}
        memberCount={activeChannel.member_user_ids.length + 1}
        backAriaLabel={backToListLabel}
        onBack={onBack}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onOpenSettings={onOpenChannelSettings}
        onCatchUp={onCatchUp}
        catchUpDisabled={catchUpDisabled}
        onOpenRecordings={onOpenRecordings}
        onVoiceCall={onVoiceCall}
        voiceCallDisabled={voiceCallDisabled}
        onVideoCall={onVideoCall}
        videoCallDisabled={videoCallDisabled}
        onSearch={onSearch}
      />
    );
  }
  if (target.kind === "dm" && activeContact) {
    return (
      <DmChatToolbar
        contact={
          contacts.find((entry) => entry.user_id === activeContact.user_id) ??
          activeContact
        }
        nicknamesByUserId={nicknamesByUserId}
        backAriaLabel={backToListLabel}
        onBack={onBack}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onOpenSettings={onOpenDmSettings}
        onCatchUp={onCatchUp}
        catchUpDisabled={catchUpDisabled}
        onOpenRecordings={onOpenRecordings}
        onVoiceCall={onVoiceCall}
        voiceCallDisabled={voiceCallDisabled}
        onVideoCall={onVideoCall}
        videoCallDisabled={videoCallDisabled}
      />
    );
  }
  return null;
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
}) {
  // Workspace settings › Members is where invitations are sent.
  const workspace = useOptionalWorkspace()?.workspace;
  const inviteHref = workspace
    ? `${paths.workspace(workspace.organization_slug, workspace.slug).settings()}?tab=members`
    : undefined;
  const tile = (icon: typeof Home) => (
    <IconTile icon={icon} tone={moduleTone("chat")} size="lg" className="size-14 rounded-2xl [&_svg]:size-7" />
  );
  if (target.kind === "workspace") {
    // Say what is true for this workspace today: alone, the room is a place
    // to invite people into; with others, it is where all of them already are.
    const alone = workspaceMemberCount <= 1;
    const invite = inviteHref ? (
      <AppLink
        href={inviteHref}
        className={buttonVariants({ variant: alone ? "default" : "ghost", size: "sm" })}
      >
        <UserPlus aria-hidden />
        {alone ? t("chat.intro_invite_first") : t("chat.intro_invite_more")}
      </AppLink>
    ) : null;
    return (
      <ChatConversationIntro
        mark={tile(Home)}
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
              <Button type="button" variant="outline" size="sm" onClick={onViewMembers}>
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
          <Button type="button" variant="outline" size="sm" onClick={onAddMembers}>
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
            <Button type="button" variant="outline" size="sm" onClick={onAddMembers}>
              <UserPlus aria-hidden />
              {t("chat.settings_add_member")}
            </Button>
          )
        }
      />
    );
  }
  const name = displayLabelForChatContact(target.contact, nicknamesByUserId);
  return (
    <ChatConversationIntro
      mark={<ActorAvatar name={name} initials={initialOf(name)} size="2xl" />}
      title={t("chat.intro_dm_title", { name })}
      description={t("chat.intro_dm_description")}
    />
  );
}
