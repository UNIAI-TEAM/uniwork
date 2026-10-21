import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import { IDENTITY_TINTS, identityTint } from "@uniwork/core/chat/identity-tint";

/**
 * Tints for departments, assigned by their order in the organization rather
 * than hashed: with a handful of departments a hash lands two of them on the
 * same colour, and a colour that does not tell teams apart is noise. The
 * first seven departments are always distinct; past that the cycle repeats.
 * An id not in the list (still loading, or archived) falls back to its hash
 * (identityTint, @uniwork/core/chat/identity-tint).
 */
export function departmentTints(departmentIds: readonly string[]): (id: string) => Tint {
  const byId = new Map(departmentIds.map((id, i) => [id, IDENTITY_TINTS[i % IDENTITY_TINTS.length]!]));
  return (id) => byId.get(id) ?? identityTint(id);
}
