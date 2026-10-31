// The messages on screen split into windows for their task links (the web's
// chat-message-links-context asks once per window too). One key that joined
// every id changed with each new message and refetched everything shown, up
// to five GETs a message. A window here ends after a message
// whose id hashes to 0 mod WINDOW_MEAN, so where windows split depends on the
// ids alone: a new message changes the newest window only, an older page adds
// windows in front and leaves the rest as they were, and each window keeps its
// cached answer. WINDOW_MAX caps a run of unlucky hashes.

/** About how many messages a window holds on average. */
const WINDOW_MEAN = 16;
/** A window never holds more (the server's batch of message ids is larger). */
const WINDOW_MAX = 48;

/** FNV-1a, 32-bit: cheap, stable across launches and platforms. */
function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** `ids` (oldest first) in consecutive windows; none for no ids. */
export function linkWindows(ids: readonly string[]): string[][] {
  const windows: string[][] = [];
  let current: string[] = [];
  for (const id of ids) {
    current.push(id);
    if (hash(id) % WINDOW_MEAN === 0 || current.length === WINDOW_MAX) {
      windows.push(current);
      current = [];
    }
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

/** One task under a message: which link, and whether the task was made from the message. */
export interface MessageTaskRef {
  taskId: string;
  linkId: string;
  relation: string;
}

/** What the screen reads of a message link (data/chat-api.ts › MessageLinkSchema). */
interface MessageLink {
  id: string;
  message_id: string;
  target_type: string;
  target_id: string;
  relation?: string;
}

/**
 * The task ids under each message, from each window's answer. A window still
 * waiting for one (its key changed when a message joined it, or an older page
 * merged into it) keeps the ids its messages showed before, so their cards stay
 * and their rows do not redraw until the answer comes. The query's
 * `keepPreviousData` cannot do this: `useQueries` gives a changed key a new
 * observer, which has no previous data to keep.
 */
export function taskIdsByMessage(
  windows: readonly (readonly string[])[],
  answers: readonly (readonly MessageLink[] | undefined)[],
  previous: ReadonlyMap<string, readonly MessageTaskRef[]>,
): Map<string, readonly MessageTaskRef[]> {
  const map = new Map<string, readonly MessageTaskRef[]>();
  windows.forEach((ids, i) => {
    const answer = answers[i];
    if (!answer) {
      for (const id of ids) {
        const kept = previous.get(id);
        if (kept) map.set(id, kept);
      }
      return;
    }
    for (const link of answer) {
      if (link.target_type !== "task") continue;
      const next: MessageTaskRef = { taskId: link.target_id, linkId: link.id, relation: link.relation ?? "" };
      map.set(link.message_id, [...(map.get(link.message_id) ?? []), next]);
    }
  });
  return map;
}
