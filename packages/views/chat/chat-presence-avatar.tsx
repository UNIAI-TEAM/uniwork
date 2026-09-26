"use client";

import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import type { AvatarSize } from "@uniwork/ui/lib/avatar-size";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * Avatar with an optional online presence dot. The dot's ring is cut from
 * --row-fill when the host row publishes one, so it reads as a notch on a
 * hovered or selected row instead of a white halo.
 */
export function ChatPresenceAvatar({
  name,
  initials,
  avatarUrl,
  size = "sm",
  online = false,
  className,
}: {
  name: string;
  initials: string;
  avatarUrl?: string | null;
  size?: AvatarSize;
  online?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <ActorAvatar name={name} initials={initials} avatarUrl={avatarUrl} size={size} />
      {online ? (
        <>
          <span
            aria-hidden
            title={t("chat.presence_online")}
            className={cn(
              "absolute -right-px -bottom-px rounded-full bg-success-solid ring-2 ring-[var(--row-fill,var(--background))]",
              size === "xl" || size === "2xl" ? "size-3" : size === "lg" ? "size-2.5" : "size-2",
            )}
          />
          <span className="sr-only">{t("chat.presence_online")}</span>
        </>
      ) : null}
    </span>
  );
}
