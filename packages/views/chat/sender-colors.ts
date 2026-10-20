import { tintForegroundClass, type Tint } from "@uniwork/ui/components/common/icon-tile";
import { identityTint } from "../people/identity-tint";

/** A reply quote's side bar and wash, in the quoted sender's tint (same as the name and the avatar). */
const SENDER_QUOTE_CLASSES: Record<Tint, string> = {
  violet: "border-tint-violet-foreground bg-tint-violet",
  blue: "border-tint-blue-foreground bg-tint-blue",
  pink: "border-tint-pink-foreground bg-tint-pink",
  orange: "border-tint-orange-foreground bg-tint-orange",
  green: "border-tint-green-foreground bg-tint-green",
  yellow: "border-tint-yellow-foreground bg-tint-yellow",
  teal: "border-tint-teal-foreground bg-tint-teal",
  gray: "border-tint-gray-foreground bg-tint-gray",
  red: "border-tint-red-foreground bg-tint-red",
};

/**
 * Their name in their own colour: the tint their avatar is drawn in
 * (chatPersonFaceClass), so name and face read as one person (canvas).
 */
export function senderNameClass(userId: string, isOwn: boolean): string {
  if (isOwn) return "text-brand";
  return tintForegroundClass[identityTint(userId)];
}

export function senderQuoteClass(userId: string): string {
  return SENDER_QUOTE_CLASSES[identityTint(userId)];
}
