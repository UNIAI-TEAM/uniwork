// Copied from packages/views/chat/chat-initials.ts (views is off-limits to the
// app): the letters a face or a room mark shows, as the web and the canvas
// draw them ("Nguyễn Thu Hà" → "TH", "Đội Thiết kế" → "TK").

/** First letter of a display name; "?" when empty. */
export function initialOf(name: string | null | undefined): string {
  return (name ?? "").trim().slice(0, 1).toUpperCase() || "?";
}

/** Two letters for a person, from the last two words: a Vietnamese name ends in the given name. One word gives one letter. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return initialOf(name);
  return words
    .slice(-2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
}

/** A person's name short enough for a 64 pt strip: a Vietnamese name without its family name ("Nguyễn Thu Hà" → "Thu Hà"). */
export function shortNameOf(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return words.length >= 3 ? words.slice(-2).join(" ") : words.join(" ");
}

/** Two letters for a room, from its first two words; a leading "Đội" (team) is skipped so team groups stay apart. */
export function roomInitialsOf(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const rest = words.length > 1 && words[0]?.toLowerCase() === "đội" ? words.slice(1) : words;
  if (rest.length < 2) return initialOf(rest.join(" "));
  return rest
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
}
