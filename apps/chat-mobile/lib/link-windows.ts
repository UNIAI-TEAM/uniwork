// The messages on screen split into windows for their task links (the web's
// chat-message-links-context asks once per window too). One key that joined
// every id changed with each new message and refetched everything shown, up
// to five GETs a message (audit P2 Perf). A window here ends after a message
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
