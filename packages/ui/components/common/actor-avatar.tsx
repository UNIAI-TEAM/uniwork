"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Cog, Users } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";
import {
  AVATAR_SIZE_PX,
  DEFAULT_AVATAR_SIZE,
  type AvatarSize,
} from "@uniwork/ui/lib/avatar-size";
import { parseAvatarEmoji } from "@uniwork/ui/lib/avatar-emoji";

interface ActorAvatarProps {
  name: string;
  initials: string;
  avatarUrl?: string | null;
  isAgent?: boolean;
  isSystem?: boolean;
  isSquad?: boolean;
  /**
   * A tier from the semantic scale, or `fluid`: no fixed diameter, the caller
   * sizes the circle and its type through `className` (a stage tile that
   * grows with its cell). Glyphs then scale with the circle.
   */
  size?: AvatarSize | "fluid";
  /** Keep the initials up while the photo loads and fade the photo in over them. */
  fadeIn?: boolean;
  className?: string;
}

function ActorAvatar({
  name,
  initials,
  avatarUrl,
  isAgent,
  isSystem,
  isSquad,
  size = DEFAULT_AVATAR_SIZE,
  fadeIn = false,
  className,
}: ActorAvatarProps) {
  const [imgError, setImgError] = useState(false);
  // Which URL finished loading, not a flag: when the URL changes, the new
  // photo starts hidden in the same render instead of one frame late.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = Boolean(avatarUrl) && loadedSrc === avatarUrl;
  const imgRef = useRef<HTMLImageElement>(null);
  const fluid = size === "fluid";
  const px = fluid ? null : AVATAR_SIZE_PX[size];
  const emoji = parseAvatarEmoji(avatarUrl);

  useEffect(() => {
    setImgError(false);
    // A cached photo can finish before hydration, and then onLoad never fires.
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoadedSrc(avatarUrl ?? null);
  }, [avatarUrl]);

  const glyph = (ratio: number) =>
    px === null ? { width: `${ratio * 100}%`, height: `${ratio * 100}%` } : { width: px * ratio, height: px * ratio };
  const photo = Boolean(avatarUrl) && !emoji && !imgError;
  const fallback = isSystem ? (
    <Cog style={glyph(0.55)} />
  ) : isAgent ? (
    <Bot style={glyph(0.55)} />
  ) : isSquad ? (
    <Users style={glyph(0.55)} />
  ) : (
    initials
  );

  // Every actor — member, agent, squad, or system — renders as a circle. This
  // is the single source of truth for avatar shape; the upload editors mirror
  // it (packages/views/common/avatar-upload-control.tsx).
  return (
    <div
      data-slot="avatar"
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium overflow-hidden",
        fadeIn && "relative",
        (!photo || fadeIn) && "bg-muted text-muted-foreground",
        className,
        // rounded-full stays last so a call-site `className` can never override
        // the circle — avatar shape is a hard invariant, not a per-site choice.
        "rounded-full"
      )}
      style={px === null ? undefined : { width: px, height: px, fontSize: px * 0.45 }}
    >
      {emoji ? (
        <span
          role="img"
          aria-label={name}
          className="select-none leading-none"
          style={{ fontSize: px === null ? "1.3em" : px * 0.58 }}
        >
          {emoji}
        </span>
      ) : photo && !fadeIn ? (
        <img
          src={avatarUrl ?? undefined}
          alt={name}
          width={px ?? undefined}
          height={px ?? undefined}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : photo ? (
        <>
          <span aria-hidden className={cn("leading-none", loaded && "invisible")}>
            {fallback}
          </span>
          <img
            ref={imgRef}
            src={avatarUrl ?? undefined}
            alt={name}
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-opacity duration-standard motion-reduce:transition-none",
              loaded ? "opacity-100" : "opacity-0"
            )}
            onLoad={() => setLoadedSrc(avatarUrl ?? null)}
            onError={() => setImgError(true)}
          />
        </>
      ) : (
        fallback
      )}
    </div>
  );
}

export { ActorAvatar, type ActorAvatarProps };
