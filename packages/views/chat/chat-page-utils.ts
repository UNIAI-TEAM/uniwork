import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import {
  displayLabelForChatContact,
  isPlaceholderChatDisplayName,
  resolveChatNicknameForUser,
} from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { buildMemberAvatarUrlMap, lookupMemberAvatarUrl, memberAvatarUrl } from "./chat-member-avatar";

export type GroupMemberProfile = {
  user_id: string;
  display_name: string;
  email: string;
};

export type ChatNameContextEntry = {
  user_id: string;
  display_name: string;
  avatar_url?: string;
  email?: string;
};

export type WorkspaceMemberLike = {
  user_id: string;
  display_name: string;
  email: string;
  avatar_url?: unknown;
};

function displayLabelForWorkspaceMember(member: WorkspaceMemberLike): string {
  const name = member.display_name.trim();
  if (name) return name;
  const local = member.email.split("@")[0]?.trim();
  return local || member.user_id;
}

function pushNameEntry(
  entries: ChatNameContextEntry[],
  seen: Set<string>,
  user_id: string,
  display_name: string,
  avatar_url?: string,
  email?: string,
) {
  const key = user_id.trim().toUpperCase();
  const trimmedEmail = email?.trim();
  const existing = entries.find((entry) => entry.user_id.trim().toUpperCase() === key);
  if (existing) {
    if (avatar_url) existing.avatar_url = avatar_url;
    if (trimmedEmail && !existing.email) existing.email = trimmedEmail;
    const next = display_name.trim();
    if (
      next &&
      isPlaceholderChatDisplayName(existing.display_name, existing.user_id) &&
      !isPlaceholderChatDisplayName(next, user_id)
    ) {
      existing.display_name = next;
    }
    return;
  }
  if (seen.has(key)) return;
  seen.add(key);
  entries.push({
    user_id,
    display_name: display_name.trim() || user_id,
    ...(avatar_url ? { avatar_url } : {}),
    ...(trimmedEmail ? { email: trimmedEmail } : {}),
  });
}

/**
 * The workspace room's name as people see it. The server names the room
 * after the workspace; until someone renames it, it reads as the generic
 * "Chung" everywhere (list, header, settings). Once renamed, the new name
 * shows in all three.
 */
export function workspaceRoomTitle(
  roomName: string | null | undefined,
  workspaceName: string | null | undefined,
  defaultLabel: string,
): string {
  const name = roomName?.trim();
  if (!name || name === workspaceName?.trim()) return defaultLabel;
  return name;
}

export function chatHeaderTitle(
  target:
    | { kind: "workspace" }
    | { kind: "dm"; contact: ChatContact }
    | { kind: "group"; group: GroupChat }
    | { kind: "channel"; channel: ChatRoomRecord },
  contacts: ChatContact[],
  groups: GroupChat[],
  workspaceTitle: string,
  dmWithLabel: (params: { name: string }) => string,
  nicknamesByUserId: Readonly<Record<string, string>> = {},
  channels: ChatRoomRecord[] = [],
): string {
  if (target.kind === "workspace") return workspaceTitle;
  if (target.kind === "channel") {
    const live = channels.find((channel) => channel.id === target.channel.id);
    const name = live?.name ?? target.channel.name;
    return `#${name}`;
  }
  if (target.kind === "group") {
    return groups.find((group) => group.id === target.group.id)?.name ?? target.group.name;
  }
  return dmWithLabel({
    name: displayLabelForChatContact(
      contacts.find((c) => c.user_id === target.contact.user_id) ?? target.contact,
      nicknamesByUserId,
    ),
  });
}

export function buildChatNameContext(
  contacts: ChatContact[],
  activeContact: ChatContact | null,
  activeGroup: GroupChat | null,
  groupMemberProfiles: Record<string, GroupMemberProfile>,
  workspaceMembers: WorkspaceMemberLike[] = [],
  nicknamesByUserId: Readonly<Record<string, string>> = {},
): ChatNameContextEntry[] {
  const nameContext: ChatNameContextEntry[] = [];
  const seen = new Set<string>();
  const avatarByUserId = buildMemberAvatarUrlMap(workspaceMembers);

  for (const c of contacts) {
    pushNameEntry(
      nameContext,
      seen,
      c.user_id,
      displayLabelForChatContact(c, nicknamesByUserId),
      lookupMemberAvatarUrl(avatarByUserId, c.user_id),
      c.email,
    );
  }
  if (activeContact) {
    pushNameEntry(
      nameContext,
      seen,
      activeContact.user_id,
      displayLabelForChatContact(activeContact, nicknamesByUserId),
      lookupMemberAvatarUrl(avatarByUserId, activeContact.user_id),
      activeContact.email,
    );
  }
  if (activeGroup) {
    for (const memberId of activeGroup.member_user_ids) {
      if (seen.has(memberId.trim().toUpperCase())) continue;
      const profile = groupMemberProfiles[memberId];
      if (profile) {
        pushNameEntry(
          nameContext,
          seen,
          profile.user_id,
          resolveChatNicknameForUser(nicknamesByUserId, profile.user_id) || profile.display_name,
          lookupMemberAvatarUrl(avatarByUserId, profile.user_id),
          profile.email,
        );
        continue;
      }
      const contact = contacts.find((entry) => entry.user_id === memberId);
      if (contact) {
        pushNameEntry(
          nameContext,
          seen,
          contact.user_id,
          displayLabelForChatContact(contact, nicknamesByUserId),
          lookupMemberAvatarUrl(avatarByUserId, contact.user_id),
          contact.email,
        );
      }
    }
  }
  for (const member of workspaceMembers) {
    const nickname = resolveChatNicknameForUser(nicknamesByUserId, member.user_id);
    pushNameEntry(
      nameContext,
      seen,
      member.user_id,
      nickname || displayLabelForWorkspaceMember(member),
      memberAvatarUrl(member.avatar_url),
      member.email,
    );
  }
  return nameContext;
}
