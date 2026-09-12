import { ApiError } from "@uniwork/core/api";
import { slugify } from "@uniwork/core/workspaces";
import { CELESTIAL_NAMES } from "./celestial-names";

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Mirrors `ValidateSlug` in server/internal/service/slug.go, which rejects
// anything outside 2–40 characters. Without the bound on the client the CTA
// unlocks on input the server is guaranteed to answer with a 400, and its raw
// Vietnamese message leaks into the UI. Both ends of the range are reachable
// from real input through `nameToSlug`: the name "A" derives the 1-character
// slug "a", and "Công ty Cổ phần Thương mại Dịch vụ Xuất nhập khẩu Việt Nam"
// derives a 58-character one.
export const SLUG_MIN_LENGTH = 2;
export const SLUG_MAX_LENGTH = 40;

/** True only for a slug the server's length rule would accept. Empty is false. */
export function isSlugLengthValid(slug: string): boolean {
  return slug.length >= SLUG_MIN_LENGTH && slug.length <= SLUG_MAX_LENGTH;
}

const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Trả "" khi tên không sinh được ký tự hợp lệ (CJK/emoji) — người dùng tự gõ slug. */
export function nameToSlug(name: string): string {
  return slugify(name);
}

export function randomWorkspaceIdentity(random: () => number = Math.random): { name: string; slug: string } {
  const c = CELESTIAL_NAMES[Math.floor(random() * CELESTIAL_NAMES.length)]!;
  let suffix = "";
  for (let i = 0; i < 4; i += 1) suffix += SUFFIX_ALPHABET[Math.floor(random() * SUFFIX_ALPHABET.length)];
  return { name: c.name, slug: `${c.slugBase}-${suffix}` };
}

export function isSlugConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}
