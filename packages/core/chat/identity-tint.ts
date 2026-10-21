// The identity colour of a person, a room or a workspace: the same seven
// tints in the same order on the web (packages/views) and the phone
// (apps/chat-mobile, ADR 0011), so one is the same colour everywhere. Each is
// a tint of packages/ui/styles/tokens.css; red is left out because it reads as
// an error, gray because it is the "nobody set this" colour.
export const IDENTITY_TINTS = ["violet", "blue", "pink", "orange", "green", "yellow", "teal"] as const;
export type IdentityTint = (typeof IDENTITY_TINTS)[number];

/**
 * A stable tint for an id: the same person or room is the same colour on
 * every screen and every visit, so it can be recognised before it is read.
 * Identity only — it never says anything about state.
 */
export function identityTint(id: string): IdentityTint {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return IDENTITY_TINTS[hash % IDENTITY_TINTS.length]!;
}
