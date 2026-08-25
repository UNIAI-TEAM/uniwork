import { ApiError } from "@uniwork/core/api";
import { slugify } from "@uniwork/core/workspaces";
import { CELESTIAL_NAMES } from "./celestial-names";

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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
