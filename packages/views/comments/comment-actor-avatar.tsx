import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import type { AvatarSize } from "@uniwork/ui/lib/avatar-size";

/**
 * The comment surfaces' actor avatar: name in, initials/agent/system flags
 * out. Shared by task and document comments (G1-07c) so both render the same
 * person the same way; task code keeps its `TaskActorAvatar` export as an
 * alias so existing imports do not move.
 */
export function CommentActorAvatar({
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
