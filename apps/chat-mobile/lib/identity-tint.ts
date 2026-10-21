// The saturated fill a face or a room mark sits on, under white, for each of
// core's identity tints (@uniwork/core/chat/identity-tint: the same hash and
// order as the web). packages/ui/components/common/icon-tile.tsx ›
// tintSolidClass, as whole class names so NativeWind finds them.
import type { IdentityTint } from "@uniwork/core/chat/identity-tint";

export const SOLID_TINT_BG: Record<IdentityTint, string> = {
  violet: "bg-tint-violet-solid",
  blue: "bg-tint-blue-solid",
  pink: "bg-tint-pink-solid",
  orange: "bg-tint-orange-solid",
  green: "bg-tint-green-solid",
  yellow: "bg-tint-yellow-solid",
  teal: "bg-tint-teal-solid",
};
