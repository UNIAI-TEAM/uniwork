"use client";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import type { AvatarSize } from "@uniwork/ui/lib/avatar-size";
import { cn } from "@uniwork/ui/lib/utils";

/** "Nguyễn Văn An" → "NA"; a bare id or email → its first letter. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[parts.length - 1]!.slice(0, 1)}`.toUpperCase();
}

/**
 * Normalises an avatar URL from any source (workspace members type it as
 * `unknown`) to a usable string, or undefined when there is no photo.
 */
export function personAvatarSrc(avatarUrl: unknown): string | undefined {
  return typeof avatarUrl === "string" && avatarUrl.trim().length > 0 ? avatarUrl : undefined;
}

/**
 * Size vocabulary mirrors the `Avatar` primitive (sm 24px, default 32px,
 * lg 40px) plus `xl` (56px) and `stage` (fluid, for a full stage tile),
 * mapped onto the semantic avatar scale.
 */
export type MeetingPersonAvatarSize = "sm" | "default" | "lg" | "xl" | "stage";

const SIZE_TIER: Record<Exclude<MeetingPersonAvatarSize, "stage">, AvatarSize> = {
  sm: "md",
  default: "lg",
  lg: "xl",
  xl: "2xl",
};

/**
 * Initials on the dark stage. The stage tile and the default avatar fill are
 * both `muted`, so a photo-less person read as a faint ring on an empty tile;
 * a lighter chip fill keeps the disc visible against tile and stage alike.
 */
const STAGE_FALLBACK = "bg-meeting-bar-chip-hover text-meeting-bar-foreground";

/**
 * The one avatar for a person anywhere in the meetings module: their photo when
 * an avatar URL is known, otherwise uppercase initials. Decorative — it always
 * sits next to the person's visible name, so it is hidden from assistive tech.
 *
 * `className` lands on the wrapper (rings, margins, positioning); size comes
 * from `size`, never from a `size-*` override — except `stage`, which has no
 * diameter of its own and fills the wrapper the caller sizes.
 */
export function MeetingPersonAvatar({
  name,
  avatarUrl,
  size = "sm",
  tone = "surface",
  className,
}: {
  name: string;
  avatarUrl?: unknown;
  size?: MeetingPersonAvatarSize;
  /** `stage` for the dark in-room chrome, where the default fill disappears. */
  tone?: "surface" | "stage";
  className?: string;
}) {
  // `stage` grows with its tile: the caller sizes the wrapper in container
  // units, the circle fills it, and the photo fades in over the initials.
  const stage = size === "stage";
  return (
    <span
      data-slot="avatar"
      aria-hidden
      className={cn("inline-flex shrink-0 rounded-full", className)}
    >
      <ActorAvatar
        name=""
        initials={initials(name)}
        avatarUrl={personAvatarSrc(avatarUrl)}
        size={stage ? "fluid" : SIZE_TIER[size]}
        fadeIn={stage}
        className={cn(
          (tone === "stage" || stage) && STAGE_FALLBACK,
          stage && "size-full text-avatar-stage",
        )}
      />
    </span>
  );
}
