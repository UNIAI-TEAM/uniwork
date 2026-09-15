import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import type { AvatarSize } from "@uniwork/ui/lib/avatar-size";

export function TaskActorAvatar({
  name,
  avatarUrl,
  kind,
  size = "xs",
  className,
}: {
  name: string;
  avatarUrl?: string;
  kind?: string;
  size?: AvatarSize;
  className?: string;
}) {
  return (
    <ActorAvatar
      name={name}
      initials={name.trim().charAt(0).toUpperCase() || "?"}
      avatarUrl={avatarUrl}
      isAgent={kind === "agent"}
      isSystem={kind === "system"}
      size={size}
      className={className}
    />
  );
}
