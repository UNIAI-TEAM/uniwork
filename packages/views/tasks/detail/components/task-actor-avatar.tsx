import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";

export function TaskActorAvatar({
  name,
  avatarUrl,
  kind,
}: {
  name: string;
  avatarUrl?: string;
  kind?: string;
}) {
  return (
    <ActorAvatar
      name={name}
      initials={name.trim().charAt(0).toUpperCase() || "?"}
      avatarUrl={avatarUrl}
      isAgent={kind === "agent"}
      isSystem={kind === "system"}
      size="xs"
    />
  );
}
