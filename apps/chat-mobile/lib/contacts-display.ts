// Ported from packages/views/chat/chat-search-fold.ts (foldVi, foldedIncludes),
// packages/views/chat/workspace-member-picker-utils.ts (memberToChatContact,
// filterWorkspaceMembers) and packages/core/chat/contacts-store.ts
// (resolveChatNicknameForUser, displayLabelForChatContact): the contacts tab
// names, finds and leaves out people the way the web's member picker does.
// The A–Z grouping is the tab's own.
import { isPlaceholderChatDisplayName } from "@uniwork/core/chat/chat-room-helpers";

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

/** NFD, combining marks stripped, đ → d, lower case: "tuan" finds "Tuấn". */
export function foldVi(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

/** True when every folded word of `query` appears in the folded `text`. */
export function foldedIncludes(text: string, query: string): boolean {
  const q = foldVi(query).trim();
  if (!q) return true;
  const hay = foldVi(text);
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/** A personal nickname whatever the ULID casing of the map's keys. */
export function resolveChatNicknameForUser(
  nicknamesByUserId: Readonly<Record<string, string>> | undefined,
  userId: string,
): string | undefined {
  if (!nicknamesByUserId) return undefined;
  const direct = nicknamesByUserId[userId]?.trim();
  if (direct) return direct;
  const key = userId.trim().toUpperCase();
  for (const [id, nickname] of Object.entries(nicknamesByUserId)) {
    const trimmed = nickname.trim();
    if (id.trim().toUpperCase() === key && trimmed) return trimmed;
  }
  return undefined;
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
