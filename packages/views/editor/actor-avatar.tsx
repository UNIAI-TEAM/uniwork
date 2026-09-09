"use client";

import { ActorAvatar as UiActorAvatar } from "@uniwork/ui/components/common/actor-avatar";

/** Thin adapter: uniwork mention rows pass actorType/actorId; UniWork UI wants name/initials. */
export function ActorAvatar({
  actorType,
  actorId,
  name,
  size = "sm",
  className,
}: {
  actorType?: string;
  actorId?: string;
  name?: string;
  size?: "sm" | "md" | "lg" | "xs";
  className?: string;
}) {
  const label = name?.trim() || actorId || actorType || "?";
  const initials = label.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <UiActorAvatar
      name={label}
      initials={initials}
      isAgent={actorType === "agent"}
      size={size}
      className={className}
    />
  );
}
