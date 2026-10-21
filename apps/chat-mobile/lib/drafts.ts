// What someone was writing in a conversation and did not send (audit UX P2
// "no-draft-persistence"): the composer's text and the message it quotes, per
// person, workspace, room and thread, kept across leaving the room and across
// a restart, as WhatsApp, Telegram and Slack keep them; the inbox shows it as
// "Nháp: …" on the room's row. Pure: the store (data/stores/draft-store.ts)
// persists it in the encrypted device store and reads it back through
// DraftSchema, so a draft is never cast from disk.
import { z } from "zod";

/** A draft no one touched for this long is dropped on the next read (a room left long ago). */
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface DraftReply {
  id: string;
  sender: string;
  text: string;
}

export interface Draft {
  text: string;
  reply?: DraftReply;
  updatedAt: number;
}

const id = z.string().min(1);

const DraftSchema = z.object({
  text: z.string(),
  reply: z.object({ id, sender: z.string(), text: z.string() }).optional(),
  updatedAt: z.number().finite(),
});

/** One draft per person, workspace, room and thread; a room's own composer has no thread part. */
export function draftKey(userId: string, wsId: string, roomId: string, threadRootId?: string): string {
  return [userId, wsId, roomId, threadRootId ?? ""].join("/");
}

/** Nothing worth keeping: no text and no quoted message. */
export function isEmptyDraft(draft: Pick<Draft, "text" | "reply">): boolean {
  return draft.text.trim() === "" && !draft.reply;
}

/** Drafts read back from disk: each whole and recent, anything else dropped alone. */
export function readDrafts(value: unknown, now: number): Record<string, Draft> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, Draft> = {};
  for (const [key, raw] of Object.entries(value)) {
    const parsed = DraftSchema.safeParse(raw);
    if (parsed.success && now - parsed.data.updatedAt < DRAFT_TTL_MS && !isEmptyDraft(parsed.data)) out[key] = parsed.data;
  }
  return out;
}

/** The rooms of one person's workspace with a draft in the room's own composer, as the inbox line: one line, trimmed. */
export function roomDraftLines(drafts: Readonly<Record<string, Draft>>, userId: string, wsId: string): Record<string, string> {
  const prefix = `${userId}/${wsId}/`;
  const out: Record<string, string> = {};
  for (const [key, draft] of Object.entries(drafts)) {
    if (!key.startsWith(prefix) || !key.endsWith("/")) continue;
    const line = draft.text.replace(/\s+/g, " ").trim();
    if (line) out[key.slice(prefix.length, -1)] = line;
  }
  return out;
}
