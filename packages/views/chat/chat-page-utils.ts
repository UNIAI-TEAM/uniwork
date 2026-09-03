import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";

export type GroupMemberProfile = {
  user_id: string;
  display_name: string;
  email: string;
};

export type ChatNameContextEntry = {
  user_id: string;
  display_name: string;
};

export type WorkspaceMemberLike = {
  user_id: string;
  display_name: string;
  email: string;
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
) {
  if (seen.has(user_id)) return;
  seen.add(user_id);
  entries.push({
    user_id,
    display_name: display_name.trim() || user_id,
  });
}

export function chatHeaderTitle(
  target: { kind: "workspace" } | { kind: "dm"; contact: ChatContact } | { kind: "group"; group: GroupChat },
  contacts: ChatContact[],
  groups: GroupChat[],
  workspaceTitle: string,
  dmWithLabel: (params: { name: string }) => string,
): string {
  if (target.kind === "workspace") return workspaceTitle;
  if (target.kind === "group") {
    return groups.find((group) => group.id === target.group.id)?.name ?? target.group.name;
  }
  return dmWithLabel({
    name: displayLabelForChatContact(
      contacts.find((c) => c.user_id === target.contact.user_id) ?? target.contact,
    ),
  });
}

export function buildChatNameContext(
  contacts: ChatContact[],
  activeContact: ChatContact | null,
  activeGroup: GroupChat | null,
  groupMemberProfiles: Record<string, GroupMemberProfile>,
  workspaceMembers: WorkspaceMemberLike[] = [],
): ChatNameContextEntry[] {
  const nameContext: ChatNameContextEntry[] = [];
  const seen = new Set<string>();

  for (const c of contacts) {
    pushNameEntry(nameContext, seen, c.user_id, displayLabelForChatContact(c));
  }
  if (activeContact) {
    pushNameEntry(
      nameContext,
      seen,
      activeContact.user_id,
      displayLabelForChatContact(activeContact),
    );
  }
  if (activeGroup) {
    for (const memberId of activeGroup.member_user_ids) {
      if (seen.has(memberId)) continue;
      const profile = groupMemberProfiles[memberId];
      if (profile) {
        pushNameEntry(nameContext, seen, profile.user_id, profile.display_name);
        continue;
      }
      const contact = contacts.find((entry) => entry.user_id === memberId);
      if (contact) {
        pushNameEntry(nameContext, seen, contact.user_id, displayLabelForChatContact(contact));
      }
    }
  }
  for (const member of workspaceMembers) {
    pushNameEntry(nameContext, seen, member.user_id, displayLabelForWorkspaceMember(member));
  }
  return nameContext;
}
