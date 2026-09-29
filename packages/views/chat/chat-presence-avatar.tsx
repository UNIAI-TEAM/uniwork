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
      <ActorAvatar
        name={name}
        initials={initials}
        avatarUrl={avatarUrl}
        size={size}
        status={online ? { tone: "success", label: t("chat.presence_online") } : undefined}
      />
    </span>
  );
}
