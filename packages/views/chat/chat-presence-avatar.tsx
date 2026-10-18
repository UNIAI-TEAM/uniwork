"use client";

import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import type { AvatarSize } from "@uniwork/ui/lib/avatar-size";
import { cn } from "@uniwork/ui/lib/utils";

/** Avatar with an optional online presence dot. */
export function ChatPresenceAvatar({
  name,
  initials,
  avatarUrl,
  size = "sm",
  online = false,
  className,
  avatarClassName,
}: {
  name: string;
  initials: string;
  avatarUrl?: string | null;
  /** `fluid` leaves the diameter and type to `avatarClassName` (the list's 48px face). */
  size?: AvatarSize | "fluid";
  online?: boolean;
  className?: string;
  /** Classes for the circle itself: its size when fluid, the initials' fill. */
  avatarClassName?: string;
}) {
  const { t } = useTranslation();
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <ActorAvatar
        name={name}
        initials={initials}
        avatarUrl={avatarUrl}
        size={size}
        className={avatarClassName}
        status={online ? { tone: "success", label: t("chat.presence_online") } : undefined}
      />
    </span>
  );
}
