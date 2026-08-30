import { runtimeConfig } from "@uniwork/core/runtime-config";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { matrixUserIdForMember } from "@uniwork/core/chat/matrix-users";
import type { useMatrixStore } from "@uniwork/core/chat/matrix-store";

export type GroupMemberProfile = {
  user_id: string;
  display_name: string;
  email: string;
  matrix_user_id: string | null;
};

export type ChatNameContextEntry = {
  user_id: string;
  display_name: string;
  matrix_user_id?: string | null;
};

export function matrixBaseUrl(
  session: ReturnType<typeof useMatrixStore.getState>["session"],
): string {
  if (session?.base_url) return session.base_url;
  return runtimeConfig().matrixHomeserverUrl;
}

export function matrixIdForContact(
  contact: ChatContact,
  session: NonNullable<ReturnType<typeof useMatrixStore.getState>["session"]>,
): string {
  return contact.matrix_user_id ?? matrixUserIdForMember(contact.user_id, session);
}

export function memberSetChanged(previous: string[], next: string[]): boolean {
  if (previous.length !== next.length) return true;
  const prevKey = [...previous].map((id) => id.toUpperCase()).sort().join("\u0000");
  const nextKey = [...next].map((id) => id.toUpperCase()).sort().join("\u0000");
  return prevKey !== nextKey;
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
): ChatNameContextEntry[] {
  const nameContext = contacts.map((c) => ({
    user_id: c.user_id,
    display_name: displayLabelForChatContact(c),
    matrix_user_id: c.matrix_user_id,
  }));
  if (activeContact) {
    nameContext.push({
      user_id: activeContact.user_id,
      display_name: displayLabelForChatContact(activeContact),
      matrix_user_id: activeContact.matrix_user_id,
    });
  }
  if (activeGroup) {
    for (const memberId of activeGroup.member_user_ids) {
      if (nameContext.some((entry) => entry.user_id === memberId)) continue;
      const profile = groupMemberProfiles[memberId];
      if (profile) {
        nameContext.push({
          user_id: profile.user_id,
          display_name: profile.display_name,
          matrix_user_id: profile.matrix_user_id,
        });
        continue;
      }
      const contact = contacts.find((entry) => entry.user_id === memberId);
      if (contact) {
        nameContext.push({
          user_id: contact.user_id,
          display_name: displayLabelForChatContact(contact),
          matrix_user_id: contact.matrix_user_id,
        });
      }
    }
  }
  return nameContext;
}
