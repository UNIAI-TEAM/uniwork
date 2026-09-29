"use client";

import { useState, useEffect } from "react";
import { Bot, Cog, Users } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";
import {
  AVATAR_SIZE_PX,
  DEFAULT_AVATAR_SIZE,
  type AvatarSize,
} from "@uniwork/ui/lib/avatar-size";
import { parseAvatarEmoji } from "@uniwork/ui/lib/avatar-emoji";

type ActorAvatarStatusTone = "success" | "warning" | "muted";

/** A dot on the avatar's corner. `label` is the translated state (hover and
 * screen readers); the caller decides what the tone means. */
interface ActorAvatarStatus {
  tone: ActorAvatarStatusTone;
  label: string;
}

interface ActorAvatarProps {
  name: string;
  initials: string;
  avatarUrl?: string | null;
  isAgent?: boolean;
  isSystem?: boolean;
  isSquad?: boolean;
  size?: AvatarSize;
  className?: string;
  status?: ActorAvatarStatus;
}

const STATUS_TONE_CLASS: Record<ActorAvatarStatusTone, string> = {
  success: "bg-success-solid",
  warning: "bg-warning-solid",
  muted: "bg-muted-foreground",
};

function statusDotSize(px: number): string {
  if (px >= 40) return "size-3";
  if (px >= 32) return "size-2.5";
  return "size-2";
}

/**
 * The dot's ring is cut from --row-fill when the host row publishes one, so it
 * reads as a notch on a hovered or selected row instead of a white halo.
 */
function ActorAvatar({ status, ...props }: ActorAvatarProps) {
  if (!status) return <ActorAvatarCircle {...props} />;
  const px = AVATAR_SIZE_PX[props.size ?? DEFAULT_AVATAR_SIZE];
  return (
    <span className="relative inline-flex shrink-0">
      <ActorAvatarCircle {...props} />
      <span
        aria-hidden
        data-slot="avatar-status"
        title={status.label}
        className={cn(
          "absolute -right-px -bottom-px rounded-full ring-2 ring-[var(--row-fill,var(--background))]",
          STATUS_TONE_CLASS[status.tone],
          statusDotSize(px),
        )}
      />
      <span className="sr-only">{status.label}</span>
    </span>
  );
}

function ActorAvatarCircle({
  name,
  initials,
  avatarUrl,
  isAgent,
  isSystem,
  isSquad,
  size = DEFAULT_AVATAR_SIZE,
  className,
}: Omit<ActorAvatarProps, "status">) {
  const [imgError, setImgError] = useState(false);
  const px = AVATAR_SIZE_PX[size];
  const emoji = parseAvatarEmoji(avatarUrl);

  useEffect(() => {
    setImgError(false);
  }, [avatarUrl]);

  // Every actor — member, agent, squad, or system — renders as a circle. This
  // is the single source of truth for avatar shape; the upload editors mirror
  // it (packages/views/common/avatar-upload-control.tsx).
  return (
    <div
      data-slot="avatar"
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium overflow-hidden",
        (!avatarUrl || emoji || imgError) && "bg-muted text-muted-foreground",
        className,
        // rounded-full stays last so a call-site `className` can never override
        // the circle — avatar shape is a hard invariant, not a per-site choice.
        "rounded-full"
      )}
      style={{ width: px, height: px, fontSize: px * 0.45 }}
    >
      {emoji ? (
        <span
          role="img"
          aria-label={name}
          className="select-none leading-none"
          style={{ fontSize: px * 0.58 }}
        >
          {emoji}
        </span>
      ) : avatarUrl && !imgError ? (
        <img
          src={avatarUrl}
          alt={name}
          width={px}
          height={px}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : isSystem ? (
        <Cog style={{ width: px * 0.55, height: px * 0.55 }} />
      ) : isAgent ? (
        <Bot style={{ width: px * 0.55, height: px * 0.55 }} />
      ) : isSquad ? (
        <Users style={{ width: px * 0.55, height: px * 0.55 }} />
      ) : (
        initials
      )}
    </div>
  );
}

export { ActorAvatar, type ActorAvatarProps, type ActorAvatarStatus };
