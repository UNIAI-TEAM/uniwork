import { foldVi, foldedIncludes } from "./chat-search-fold";

export type ChatMentionCandidate = {
  kind: "member" | "all";
  userId?: string;
  label: string;
  email?: string;
};

function sanitizeMentionLabel(label: string): string {
  return label.replace(/[\]\n\r]/g, " ").trim();
}

export function formatMemberMentionToken(label: string, userId: string): string {
  const safeLabel = sanitizeMentionLabel(label) || userId;
  return `[@${safeLabel}](mention://member/${userId})`;
}

export function formatAllMentionToken(allLabel: string): string {
  const safeLabel = sanitizeMentionLabel(allLabel) || "all";
  return `[@${safeLabel}](mention://all/all)`;
}

/** Convert stored markdown mention tokens to composer-friendly @ labels. */
export function deserializeMessageBodyToComposerDraft(body: string): string {
  if (!body.includes("mention://")) return body;
  return body
    .replace(/\[@([^\]]+)\]\(mention:\/\/member\/[^)]+\)/g, (_, label) => `@${label}`)
    .replace(/\[@([^\]]+)\]\(mention:\/\/all\/all\)/g, (_, label) => `@${label}`);
}

/** Visible @ label in the composer (not the stored markdown token). */
export function formatComposerMentionDisplay(
  candidate: ChatMentionCandidate,
  allLabel: string,
): string {
  if (candidate.kind === "all") return `@${allLabel}`;
  const label = sanitizeMentionLabel(candidate.label) || candidate.userId || "";
  return `@${label}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Swap one composer @label for its stored token. A dot does not end the
 * label, so an address like a@all.com stays an address. An existing
 * `[@label](...)` token is left alone.
 */
function replaceComposerMention(body: string, label: string, token: string): string {
  if (!label) return body;
  const pattern = new RegExp(`(?<!\\[)@${escapeRegExp(label)}(?=$|[\\s,!?;:])`, "giu");
  return body.replace(pattern, () => token);
}

/** Convert composer draft (@Name) to API body markdown tokens on send. */
export function serializeComposerDraftToMessageBody(
  draft: string,
  candidates: ChatMentionCandidate[],
  allLabel: string,
): string {
  if (!draft.includes("@") && !draft.includes("mention://")) return draft;

  let body = draft;
  const sorted = candidates
    .filter((candidate) => candidate.kind !== "all")
    .sort((a, b) => sanitizeMentionLabel(b.label).length - sanitizeMentionLabel(a.label).length);

  for (const candidate of sorted) {
    const label = sanitizeMentionLabel(candidate.label);
    if (!label || !candidate.userId) continue;
    body = replaceComposerMention(body, label, formatMemberMentionToken(label, candidate.userId));
  }
  // @all is a room-wide mention, not a member row, so it is written even when
  // the candidate list only holds people.
  const all = sanitizeMentionLabel(allLabel) || "all";
  return replaceComposerMention(body, all, formatAllMentionToken(all));
}

type MentionPerson = { user_id: string; email: string; display_name: string };

function sameUserId(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

export function buildChatMentionCandidates(
  targetKind: "workspace" | "group" | "dm" | "channel",
  currentUserId: string,
  workspaceMembers: MentionPerson[],
  groupMemberProfiles: Record<string, MentionPerson>,
  memberLabel: (member: MentionPerson) => string,
  roomMemberIds?: string[],
): ChatMentionCandidate[] {
  if (targetKind === "dm") return [];

  const people = new Map<string, MentionPerson>();
  for (const member of workspaceMembers) {
    people.set(member.user_id.trim().toUpperCase(), member);
  }
  for (const profile of Object.values(groupMemberProfiles)) {
    const key = profile.user_id.trim().toUpperCase();
    const existing = people.get(key);
    people.set(key, {
      user_id: profile.user_id || existing?.user_id || "",
      display_name: profile.display_name || existing?.display_name || "",
      email: profile.email || existing?.email || "",
    });
  }

  const scoped =
    (targetKind === "group" || targetKind === "channel") && roomMemberIds && roomMemberIds.length > 0;
  const ids = scoped
    ? roomMemberIds
    : targetKind === "group" || targetKind === "channel"
      ? Object.values(groupMemberProfiles).map((profile) => profile.user_id)
      : workspaceMembers.map((member) => member.user_id);

  const seen = new Set<string>();
  const out: ChatMentionCandidate[] = [];
  for (const id of ids) {
    const key = id.trim().toUpperCase();
    if (!key || seen.has(key) || sameUserId(key, currentUserId)) continue;
    seen.add(key);
    const person = people.get(key);
    if (!person?.user_id) continue;
    out.push({
      kind: "member",
      userId: person.user_id,
      label: memberLabel(person),
      email: person.email,
    });
  }
  return out;
}

export function messageBodyHasMention(body: string): boolean {
  return body.includes("mention://") || body.includes("[@ ");
}

/** Active @-query at cursor when user is typing a mention (not inside an existing token). */
export function getActiveMentionQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;

  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;

  const prefix = before.slice(0, at);
  if (prefix.endsWith("](")) return null;

  const segment = before.slice(at);
  if (segment.includes("](")) return null;

  return { start: at, query };
}

/**
 * The mention under the caret, including a multi-word name ("@tran hoang")
 * while that text still matches someone. A finished mention followed by a
 * space, or a sentence that no longer matches, closes the picker.
 */
export function resolveActiveMentionQuery(
  text: string,
  cursor: number,
  candidates: ChatMentionCandidate[],
  allLabel: string,
): { start: number; query: string } | null {
  const strict = getActiveMentionQuery(text, cursor);
  if (strict) return strict;

  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (!query.trim() || /[\r\n]/.test(query)) return null;
  if (before.slice(0, at).endsWith("](")) return null;
  if (before.slice(at).includes("](")) return null;

  if (/\s$/.test(query)) {
    const typed = foldVi(query.trim());
    const finished =
      foldVi(allLabel) === typed ||
      candidates.some((candidate) => candidate.kind !== "all" && foldVi(candidate.label) === typed);
    if (finished) return null;
  }

  const q = query.trim();
  const needle = foldVi(q);
  const matchesAll = foldedIncludes(allLabel, q) || foldVi(allLabel).startsWith(needle);
  const matchesMember = candidates.some((candidate) => {
    if (candidate.kind === "all" || !candidate.label) return false;
    return (
      foldVi(candidate.label).startsWith(needle) ||
      foldedIncludes(candidate.label, q) ||
      (candidate.email ? foldedIncludes(candidate.email, q) : false)
    );
  });
  if (!matchesAll && !matchesMember) return null;
  return { start: at, query };
}

export function insertMentionToken(
  draft: string,
  mentionStart: number,
  cursor: number,
  token: string,
): { nextDraft: string; nextCursor: number } {
  const before = draft.slice(0, mentionStart);
  const after = draft.slice(cursor);
  const nextDraft = `${before}${token} ${after}`;
  return { nextDraft, nextCursor: before.length + token.length + 1 };
}

export function filterMentionCandidates(
  candidates: ChatMentionCandidate[],
  query: string,
  options: { allLabel: string; includeAll?: boolean },
): ChatMentionCandidate[] {
  const q = query.trim();
  const filtered = candidates.filter((candidate) => {
    if (candidate.kind === "all") return false;
    if (!q) return true;
    // Accent-insensitive, so "tuan" finds "Tuấn".
    return foldedIncludes(candidate.label, q) || foldedIncludes(candidate.email ?? "", q);
  });

  const includeAll = options.includeAll !== false;

  if (includeAll) {
    return [{ kind: "all", label: options.allLabel }, ...filtered];
  }
  return filtered;
}

export function messageMentionsUser(message: { mentionedUserIds?: string[] }, userId: string): boolean {
  if (!message.mentionedUserIds?.length) return false;
  const normalized = userId.trim().toUpperCase();
  return message.mentionedUserIds.some((id) => id.trim().toUpperCase() === normalized);
}
