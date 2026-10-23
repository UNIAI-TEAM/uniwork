/** First letter of a display name for an avatar fallback; "?" when empty. */
export function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

/**
 * Two letters for a person's face, from the last two words: a Vietnamese
 * name ends in the given name ("Nguyễn Thu Hà" → "TH"). One word gives one
 * letter. A room's face uses roomInitialsOf.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return initialOf(name);
  return words
    .slice(-2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
}

/**
 * Two letters for a room's face, from its first two words ("Ra mắt UniWork
 * Q4" → "RM", "Nhóm thiết kế" → "NT"). A leading "Đội" (team) is skipped:
 * a workspace's team groups all start with it, and their faces would blur
 * ("Đội Thiết kế" → "TK", "Đội Nội dung" → "ND"), as the canvas draws them.
 */
export function roomInitialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const rest = words.length > 1 && words[0]?.toLowerCase() === "đội" ? words.slice(1) : words;
  if (rest.length < 2) return initialOf(rest.join(" "));
  return rest
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
}

/**
 * The name a busy list line uses for a person, the given name a Vietnamese
 * name ends with ("Bùi Minh Quân" → "Quân", canvas "Quân: …", "Minh đang
 * nhập…"). An all-capitals last word is an acronym, not a given name
 * ("Phòng HC"), so that name stays whole.
 */
export function givenNameOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? "";
  return words.length < 2 || /^\p{Lu}+$/u.test(last) ? name.trim() : last;
}
