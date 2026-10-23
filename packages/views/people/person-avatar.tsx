"use client";

import { tintClass } from "@uniwork/ui/components/common/icon-tile";
import { Avatar, AvatarFallback, AvatarImage } from "@uniwork/ui/components/ui/avatar";
import { cn } from "@uniwork/ui/lib/utils";
import { initials } from "./actor-chip";
import { identityTint } from "./identity-tint";

const SIZE = {
  xs: { root: "size-5", text: "text-micro" },
  sm: { root: "size-6", text: "text-micro" },
  md: { root: "size-10", text: "text-label" },
  lg: { root: "size-16 sm:size-20", text: "text-title" },
} as const;

/**
 * One person's face, or their initials on their own tint when there is no
 * photo — a grid of identical grey discs gives the eye nothing to hold on to.
 * A deactivated person is drawn faded, so the state reads before the badge.
 */
export function PersonAvatar({
  id,
  name,
  avatarUrl,
  size = "md",
  deactivated = false,
  className,
}: {
  id: string;
  name: string;
  avatarUrl?: string;
  size?: keyof typeof SIZE;
  deactivated?: boolean;
  className?: string;
}) {
  return (
    <Avatar className={cn("shrink-0", SIZE[size].root, deactivated && "opacity-60 grayscale", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback className={cn("font-semibold", SIZE[size].text, tintClass[identityTint(id)])}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
