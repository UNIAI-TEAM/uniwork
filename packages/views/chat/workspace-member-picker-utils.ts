import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { Member } from "@uniwork/core/types/workspace";
import { foldedIncludes } from "./chat-search-fold";

export function memberToChatContact(member: { user_id: string; email: string; display_name: string }): ChatContact {
  const name = member.display_name.trim();
  const display_name = name || member.email.split("@")[0]?.trim() || member.user_id;
  return {
    user_id: member.user_id,
    email: member.email,
    display_name,
  };
}

export function memberDisplayLabel(member: { user_id: string; email: string; display_name: string }): string {
  return memberToChatContact(member).display_name;
}

export function filterWorkspaceMembers(
  members: Member[],
  options: {
    currentUserId: string;
    excludeUserIds?: ReadonlySet<string>;
    query: string;
    /** Match the display name only, for a screen that never shows an email. */
    nameOnly?: boolean;
  },
): Member[] {
  const q = options.query.trim();
  const matches = members.filter((member) => {
    if (member.user_id === options.currentUserId) return false;
    if (options.excludeUserIds?.has(member.user_id)) return false;
    if (!q) return true;
    // Accent-insensitive, so "tuan" finds "Tuấn".
    if (options.nameOnly) return foldedIncludes(member.display_name.trim(), q);
    return foldedIncludes(memberDisplayLabel(member), q) || foldedIncludes(member.email, q);
  });
  // By name, as the canvas lists them ("Hoàng Lan", "Lê Minh Châu", …), not in join order.
  return matches.sort((a, b) => memberDisplayLabel(a).localeCompare(memberDisplayLabel(b), "vi"));
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

/**
 * Why a picker list is empty, so the line under it tells the truth:
 * a typed query that matched no one, a workspace with nobody else in it
 * yet, or everyone already picked (or already in the room).
 */
type MemberPickerEmptyReason = "no_match" | "no_other_members" | "all_picked";

export function memberPickerEmptyReason({
  query,
  hasOtherMembers,
}: {
  query: string;
  hasOtherMembers: boolean;
}): MemberPickerEmptyReason {
  if (query.trim()) return "no_match";
  return hasOtherMembers ? "all_picked" : "no_other_members";
}
