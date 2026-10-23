// What a reaction, a poll vote or an edit does to a message before the server
// confirms it (reactions, votes and edits work offline). The server's rules,
// copied so the bubble shows the person's choice at once, online or not:
// a reaction toggles one emoji of the viewer's (ChatService.
// ToggleChatMessageReaction), a vote toggles one option, or with a
// single-choice poll replaces the choice (server/internal/service/
// chat_poll.go › applyPollVote). data/pending-ops.ts queues the request and
// the server's answer replaces this copy.
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";

/** The message with the viewer's `emoji` on or off; unchanged when it already is. */
export function withReaction(record: ChatMessageRecord, emoji: string, on: boolean): ChatMessageRecord {
  const mine = new Set(record.my_reactions ?? []);
  if (mine.has(emoji) === on) return record;
  const count = (record.reactions[emoji] ?? 0) + (on ? 1 : -1);
  const reactions = { ...record.reactions };
  if (count > 0) reactions[emoji] = count;
  else delete reactions[emoji];
  if (on) mine.add(emoji);
  else mine.delete(emoji);
  return { ...record, reactions, my_reactions: [...mine] };
}

/** The message as the person just edited it: the new body, marked edited at `at` (the server's copy replaces it, mentions included). */
export function withEdit(record: ChatMessageRecord, body: string, at: string): ChatMessageRecord {
  return record.body === body ? record : { ...record, body, edited_at: at };
}

export function hasReaction(record: Pick<ChatMessageRecord, "my_reactions">, emoji: string): boolean {
  return (record.my_reactions ?? []).includes(emoji);
}

type Poll = NonNullable<ChatMessageRecord["poll"]>;

/** The viewer's choice after one tap on `optionId`, as the server applies it. */
export function toggledPollChoice(poll: Poll, optionId: string): string[] {
  const current = poll.viewer_option_ids;
  if (poll.settings.allow_multiple) return current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
  return current.length === 1 && current[0] === optionId ? [] : [optionId];
}

const sameChoice = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** The poll with the viewer's choice set to `choice`, counts moved by the difference. */
export function withPollChoice(record: ChatMessageRecord, choice: readonly string[]): ChatMessageRecord {
  const poll = record.poll;
  if (!poll || sameChoice(poll.viewer_option_ids, choice)) return record;
  const before = new Set(poll.viewer_option_ids);
  const after = new Set(choice);
  const options = poll.options.map((option) => ({
    ...option,
    votes: Math.max(0, option.votes + (after.has(option.id) ? 1 : 0) - (before.has(option.id) ? 1 : 0)),
  }));
  return { ...record, poll: { ...poll, options, viewer_option_ids: [...choice] } };
}

/**
 * The taps that take the server from `current` to `desired`: one per option
 * that differs on a multiple-choice poll; on a single-choice one a tap on the
 * chosen option, or on the current one to clear it.
 */
export function pollTapsToReach(current: readonly string[], desired: readonly string[], allowMultiple: boolean): string[] {
  if (sameChoice(current, desired)) return [];
  if (allowMultiple) return [...current.filter((id) => !desired.includes(id)), ...desired.filter((id) => !current.includes(id))];
  return desired.length > 0 ? [desired[0]!] : [current[0]!];
}
