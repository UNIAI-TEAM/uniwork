// Copied from packages/views/people/identity-tint.ts › identityTint (views is
// off-limits to the app): the same seven tints in the same order, so a person
// or a room is the same colour on the phone as on the web. Red stays out
// because it reads as an error, gray because it is "nobody set this".
export const IDENTITY_TINTS = ["violet", "blue", "pink", "orange", "green", "yellow", "teal"] as const;
export type IdentityTint = (typeof IDENTITY_TINTS)[number];

/** A stable tint for an id: the same room is the same colour on every screen and visit. */
export function identityTint(id: string): IdentityTint {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return IDENTITY_TINTS[hash % IDENTITY_TINTS.length]!;
}

/**
 * The saturated fill a face or a room mark sits on, under white
 * (packages/ui/components/common/icon-tile.tsx › tintSolidClass). Whole class
 * names, so NativeWind finds them.
 */
export const SOLID_TINT_BG: Record<IdentityTint, string> = {
  violet: "bg-tint-violet-solid",
  blue: "bg-tint-blue-solid",
  pink: "bg-tint-pink-solid",
  orange: "bg-tint-orange-solid",
  green: "bg-tint-green-solid",
  yellow: "bg-tint-yellow-solid",
  teal: "bg-tint-teal-solid",
};
