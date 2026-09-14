"use client";

import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import type { AvatarSize } from "@uniwork/ui/lib/avatar-size";
import { cn } from "@uniwork/ui/lib/utils";

/** Avatar with an optional green online presence badge. */
export function ChatPresenceAvatar({
  name,
  initials,
  size = "sm",
  online = false,
  className,
}: {
  name: string;
  initials: string;
  size?: AvatarSize;
  online?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <ActorAvatar name={name} initials={initials} size={size} />
      {online ? (
        <span
          className={cn(
            "absolute right-0 bottom-0 rounded-full bg-success ring-2 ring-background",
            size === "xl" ? "size-3" : "size-2",
          )}
          aria-label={t("chat.presence_online")}
          title={t("chat.presence_online")}
        />
      ) : null}
    </span>
  );
}
