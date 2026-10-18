// Copied from packages/views/people/identity-tint.ts › identityTint (views is
// off-limits to the app), cut to the tints the mobile theme carries; red stays
// out as on the web, because it reads as an error.
export const IDENTITY_TINTS = ["blue", "orange", "green", "yellow", "teal"] as const;
export type IdentityTint = (typeof IDENTITY_TINTS)[number];

/** A stable tint for an id: the same room is the same colour on every screen and visit. */
export function identityTint(id: string): IdentityTint {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return IDENTITY_TINTS[hash % IDENTITY_TINTS.length]!;
}
