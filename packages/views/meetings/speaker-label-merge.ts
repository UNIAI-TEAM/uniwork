import type { SpeakerLabel } from "@uniwork/core/types";

/** "<identity>:<job>-<track>-<session>:<letter>", the agent's room-mic label key. */
function parse(key: string): { mic: string; session: number; letter: string } | null {
  const [identity, session, letter] = key.split(":");
  if (!identity || !session || !letter || identity === "upload") return null;
  const cut = session.lastIndexOf("-");
  const n = Number(session.slice(cut + 1));
  if (cut < 0 || !Number.isInteger(n)) return null;
  return { mic: `${identity}:${session.slice(0, cut)}`, session: n, letter };
}

const MAX_CANDIDATES = 3;

/**
 * Named speakers of the same room mic that `label` may be (benchmark #18):
 * every reopening of the STT session starts a new set of vendor letters, so
 * the "A" of the next session is often the same person. The adjacent
 * session's same letter comes first, then the mic's other named speakers.
 */
export function sameSpeakerCandidates(label: SpeakerLabel, rows: readonly SpeakerLabel[]): SpeakerLabel[] {
  const me = parse(label.label_key);
  if (!me) return [];
  const scored = rows.flatMap((r) => {
    const o = parse(r.label_key);
    if (r.id === label.id || !o || o.mic !== me.mic || !(r.user_id || r.name)) return [];
    const adjacent = Math.abs(o.session - me.session) === 1 && o.letter === me.letter;
    return [{ r, score: adjacent ? 0 : 1 }];
  });
  return scored
    .sort((a, b) => a.score - b.score || (a.r.number ?? 0) - (b.r.number ?? 0))
    .slice(0, MAX_CANDIDATES)
    .map((s) => s.r);
}
