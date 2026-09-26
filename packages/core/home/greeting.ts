/**
 * Common Vietnamese family names, without diacritics. A name that starts with
 * one is written family-first, so the name a person is called by is the last
 * word ("Phan Đức Quang" → "Quang"); any other name is taken as given-first
 * ("Anna Lee" → "Anna").
 */
const VI_FAMILY_NAMES = new Set([
  "nguyen", "tran", "le", "pham", "hoang", "huynh", "phan", "vu", "vo", "dang", "bui", "do", "ho", "ngo",
  "duong", "ly", "dinh", "doan", "trinh", "truong", "lam", "mai", "cao", "ta", "ha", "luu", "luong", "to",
  "chau", "quach", "tong", "thai", "kieu", "trieu", "khuc", "la", "van", "vuong", "lai", "ton", "tang",
]);

const plain = (word: string) =>
  word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();

/** The name the greeting calls a person by; the whole name when it is one word or unrecognisable. */
export function greetingName(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return displayName.trim();
  return VI_FAMILY_NAMES.has(plain(words[0]!)) ? words[words.length - 1]! : words[0]!;
}
