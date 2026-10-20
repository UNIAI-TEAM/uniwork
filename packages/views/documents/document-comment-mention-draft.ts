import type { MentionCandidate } from "@uniwork/core/types/document-access";
import { replaceComposerMention, suffixSharedLabels, type ChatMentionCandidate } from "../chat/chat-mention-utils";
import { extractMentionTokens } from "./document-comments-model";

// The composer shows a mention as "@Name"; the draft store and the wire carry the
// `[@Name](mention://member/ID)` token. The chat composer works the same way
// (chat-mention-utils), and its label swap is reused here with this surface's
// own token, whose label escapes `[`, `]`, `(`, `)` and `\` (contract-collab 3).

type MentionPerson = Pick<MentionCandidate, "user_id" | "display_name">;

const escapeLabel = (label: string) => label.replace(/[\\[\]()]/g, (ch) => `\\${ch}`);
const labelOf = (person: MentionPerson) => person.display_name || person.user_id;

export function mentionToken(person: MentionPerson): string {
  return `[@${escapeLabel(labelOf(person))}](mention://member/${person.user_id})`;
}

/** The visible text a picked person leaves in the textarea. */
export function mentionDisplay(person: MentionPerson): string {
  return `@${labelOf(person)}`;
}

/** The people a stored body already mentions, so an edit keeps the ids it was written with. */
export function mentionPeopleInBody(body: string): MentionPerson[] {
  return extractMentionTokens(body).map((token) => ({ user_id: token.userId, display_name: token.label }));
}

/**
 * The person to insert: when someone else in the body already goes by the same name, the
 * label gets chat's suffix (email name, then id), so "@Name" spells one person.
 */
export function withUniqueLabel<T extends MentionPerson & { email?: string }>(person: T, inBody: MentionPerson[]): T {
  const list: ChatMentionCandidate[] = [
    ...inBody
      .filter((other) => other.user_id.toUpperCase() !== person.user_id.toUpperCase())
      .map((other) => ({ kind: "member" as const, userId: other.user_id, label: labelOf(other) })),
    { kind: "member", userId: person.user_id, label: labelOf(person), email: person.email },
  ];
  const suffix = (c: ChatMentionCandidate) => c.email?.split("@")[0]?.trim() || c.userId || "";
  suffixSharedLabels(list, suffix);
  suffixSharedLabels(list, (c) => c.userId ?? "");
  const label = list[list.length - 1]!.label;
  return label === labelOf(person) ? person : { ...person, display_name: label };
}

/** Stored body to composer text: every member token becomes "@Name". */
export function commentBodyToDisplay(body: string): string {
  if (!body.includes("mention://")) return body;
  return body.replace(
    /\[@((?:[^[\]\\]|\\.)*)\]\(mention:\/\/member\/[0-9A-Za-z]{26}\)/g,
    (_, label: string) => `@${label.replace(/\\(.)/g, "$1")}`,
  );
}

/**
 * Composer text to stored body. A "@Name" that still spells a known person's whole
 * name becomes their token; text cut short or edited stays plain, like chat. Earlier
 * people win a shared name, longer names go first.
 */
export function commentDisplayToBody(display: string, people: MentionPerson[]): string {
  if (!display.includes("@")) return display;
  let body = display;
  const sorted = people
    .filter((person) => labelOf(person))
    .sort((a, b) => labelOf(b).length - labelOf(a).length);
  for (const person of sorted) body = replaceComposerMention(body, labelOf(person), mentionToken(person));
  return body;
}
