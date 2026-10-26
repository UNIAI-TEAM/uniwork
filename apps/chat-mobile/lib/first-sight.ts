// "Has this process drawn this key before?", for a moment that should play
// once: a sent message fades in the first time its bubble appears, not each
// time a list re-mounts the cell as it scrolls back into view. Bounded: past
// `limit` keys the oldest is forgotten (a Set keeps insertion order).

/** A tracker whose call answers true the first time it sees `key`, and false after. */
export function createFirstSight(limit: number): (key: string) => boolean {
  const seen = new Set<string>();
  return (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size <= limit) return true;
    for (const oldest of seen) {
      seen.delete(oldest);
      break;
    }
    return true;
  };
}
