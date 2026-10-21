// Ported from packages/views/chat/workspace-member-picker-utils.ts
// (memberToChatContact, filterWorkspaceMembers): the contacts tab names, finds
// and leaves out people the way the web's member picker does, with core's
// search folding and nickname resolver. The A–Z grouping is the tab's own.
import { isPlaceholderChatDisplayName } from "@uniwork/core/chat/chat-room-helpers";
import { resolveChatNicknameForUser } from "@uniwork/core/chat/contact-labels";
import { foldVi, foldedIncludes } from "@uniwork/core/chat/search-fold";

export interface ContactMember {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url?: string;
}

export interface ContactRow extends ContactMember {
  /** nickname, else name, else email: what the row shows */
  label: string;
}

export interface ContactSection {
  title: string;
  data: ContactRow[];
}

/** The web's label: nickname, then a real display name (never a raw ULID), then email. */
export function contactLabel(member: ContactMember, nicknames?: Readonly<Record<string, string>>): string {
  const nickname = resolveChatNicknameForUser(nicknames, member.user_id);
  if (nickname) return nickname;
  const name = member.display_name.trim();
  // memberToChatContact: an empty name falls back to the email's local part.
  const displayName = name || member.email.split("@")[0]?.trim() || member.user_id;
  if (!isPlaceholderChatDisplayName(displayName, member.user_id)) return displayName;
  return member.email.trim() || displayName;
}

/**
 * Everyone but the viewer and the hidden ids (deactivated people), matching
 * the query on the shown label, the name or the email, sorted by label and
 * grouped under its first letter ("#" for anything else).
 */
export function contactSections(
  members: readonly ContactMember[],
  options: {
    currentUserId: string;
    hiddenUserIds: ReadonlySet<string>;
    nicknames?: Readonly<Record<string, string>>;
    query: string;
  },
): ContactSection[] {
  const rows: { row: ContactRow; title: string; key: string }[] = [];
  for (const member of members) {
    if (member.user_id === options.currentUserId || options.hiddenUserIds.has(member.user_id)) continue;
    const label = contactLabel(member, options.nicknames);
    const matches = [label, member.display_name, member.email].some((text) => foldedIncludes(text, options.query));
    if (!matches) continue;
    const key = foldVi(label);
    const first = key.charAt(0).toUpperCase();
    // "#" (digits, symbols) sorts after Z, as phone address books do.
    rows.push({ row: { ...member, label }, key, title: /[A-Z]/.test(first) ? first : "#" });
  }
  rows.sort((a, b) => Number(a.title === "#") - Number(b.title === "#") || a.key.localeCompare(b.key));
  const sections: ContactSection[] = [];
  for (const { row, title } of rows) {
    const last = sections.at(-1);
    if (last?.title === title) last.data.push(row);
    else sections.push({ title, data: [row] });
  }
  return sections;
}
