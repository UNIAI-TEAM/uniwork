import type { Tint } from "@uniwork/ui/components/common/icon-tile";

/**
 * Tints a person or a department may take. Red is left out because it reads
 * as an error, gray because it is the "nobody set this" colour.
 */
const IDENTITY_TINTS: readonly Tint[] = ["violet", "blue", "pink", "orange", "green", "yellow", "teal"];

/**
 * A stable tint for an id: the same person or department is the same colour
 * on every screen and every visit, so it can be recognised before it is read.
 * Identity only — it never says anything about state.
 */
export function identityTint(id: string): Tint {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return IDENTITY_TINTS[hash % IDENTITY_TINTS.length]!;
}

/**
 * Tints for departments, assigned by their order in the organization rather
 * than hashed: with a handful of departments a hash lands two of them on the
 * same colour, and a colour that does not tell teams apart is noise. The
 * first seven departments are always distinct; past that the cycle repeats.
 * An id not in the list (still loading, or archived) falls back to its hash.
 */
export function departmentTints(departmentIds: readonly string[]): (id: string) => Tint {
  const byId = new Map(departmentIds.map((id, i) => [id, IDENTITY_TINTS[i % IDENTITY_TINTS.length]!]));
  return (id) => byId.get(id) ?? identityTint(id);
}
