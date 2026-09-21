/** First letter of a display name for an avatar fallback; "?" when empty. */
export function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}
