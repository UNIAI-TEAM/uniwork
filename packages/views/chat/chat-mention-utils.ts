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

/** Convert composer draft (@Name) to API body markdown tokens on send. */
export function serializeComposerDraftToMessageBody(
  draft: string,
  candidates: ChatMentionCandidate[],
  allLabel: string,
): string {
  if (!draft.includes("@") && !draft.includes("mention://")) return draft;

  let body = draft;
  const sorted = [...candidates].sort(
    (a, b) => sanitizeMentionLabel(b.label).length - sanitizeMentionLabel(a.label).length,
  );

  for (const candidate of sorted) {
    if (candidate.kind === "all") {
      const token = formatAllMentionToken(allLabel);
      const pattern = new RegExp(`@${escapeRegExp(allLabel)}(?=\\s|$|[.,!?;:])`, "gi");
      body = body.replace(pattern, token);
      continue;
    }
    const label = sanitizeMentionLabel(candidate.label);
    if (!label || !candidate.userId) continue;
    const token = formatMemberMentionToken(label, candidate.userId);
    const pattern = new RegExp(`@${escapeRegExp(label)}(?=\\s|$|[.,!?;:])`, "gi");
    body = body.replace(pattern, token);
  }

  return body;
}

export function buildChatMentionCandidates(
  targetKind: "workspace" | "group" | "dm",
  currentUserId: string,
  workspaceMembers: Array<{ user_id: string; email: string; display_name: string }>,
  groupMemberProfiles: Record<string, { user_id: string; display_name: string; email: string }>,
  memberLabel: (member: { user_id: string; email: string; display_name: string }) => string,
): ChatMentionCandidate[] {
  if (targetKind === "workspace") {
    return workspaceMembers
      .filter((member) => member.user_id !== currentUserId)
      .map((member) => ({
        kind: "member" as const,
        userId: member.user_id,
        label: memberLabel(member),
        email: member.email,
      }));
  }
  if (targetKind === "group") {
    return Object.values(groupMemberProfiles)
      .filter((profile) => profile.user_id !== currentUserId)
      .map((profile) => ({
        kind: "member" as const,
        userId: profile.user_id,
        label: profile.display_name,
        email: profile.email,
      }));
  }
  return [];
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
  const q = query.trim().toLowerCase();
  const filtered = candidates.filter((candidate) => {
    if (candidate.kind === "all") return false;
    if (!q) return true;
    const label = candidate.label.toLowerCase();
    const email = candidate.email?.toLowerCase() ?? "";
    return label.includes(q) || email.includes(q);
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
