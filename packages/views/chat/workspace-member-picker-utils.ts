import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { Member } from "@uniwork/core/types/workspace";

export function memberToChatContact(member: Member): ChatContact {
  const name = member.display_name.trim();
  const display_name = name || member.email.split("@")[0]?.trim() || member.user_id;
  return {
    user_id: member.user_id,
    email: member.email,
    display_name,
  };
}

export function memberDisplayLabel(member: Member): string {
  return memberToChatContact(member).display_name;
}

export function filterWorkspaceMembers(
  members: Member[],
  options: {
    currentUserId: string;
    excludeUserIds?: ReadonlySet<string>;
    query: string;
  },
): Member[] {
  const q = options.query.trim().toLowerCase();
  return members.filter((member) => {
    if (member.user_id === options.currentUserId) return false;
    if (options.excludeUserIds?.has(member.user_id)) return false;
    if (!q) return true;
    const label = memberDisplayLabel(member).toLowerCase();
    return label.includes(q) || member.email.toLowerCase().includes(q);
  });
}

export function findWorkspaceMemberByEmail(members: Member[], email: string): Member | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return null;
  return members.find((member) => member.email.trim().toLowerCase() === normalized) ?? null;
}

export function shouldLookupEmailOutsideWorkspace(
  query: string,
  members: Member[],
  searchSubmitted: boolean,
): boolean {
  if (!searchSubmitted) return false;
  const normalized = query.trim().toLowerCase();
  if (!normalized.includes("@")) return false;
  return findWorkspaceMemberByEmail(members, normalized) === null;
}
