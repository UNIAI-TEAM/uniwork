"use client";

import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { IconTile, type Tint } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { moduleTone } from "../layout/module-tones";

/**
 * A group's uploaded photo in its mark's place. Decorative: the room's name
 * sits next to it. The signed URL expires, so a failed load shows the
 * fallback (the glyph tile) until the next URL arrives.
 */
export function ChatRoomPhoto({ src, className, children }: { src?: string; className: string; children: ReactNode }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return children;
  return <img src={src} alt="" className={cn("shrink-0 object-cover", className)} onError={() => setFailedSrc(src)} />;
}

const PHOTO_SIZE = { row: "size-8 rounded-md", header: "size-10 rounded-lg", list: "size-12 rounded-xl" } as const;

/**
 * The mark of a room that is not a person — the workspace room, a group, a
 * channel. Rooms wear the chat tint; the glyph says which kind of room it is.
 * `row` matches a 32px avatar in a dense list, `header` a 40px one, and
 * `list` the conversation list's 48px squircle.
 */
export function ChatRoomMark({
  icon,
  size = "row",
  active = false,
  tint,
  imageUrl,
}: {
  icon: LucideIcon;
  size?: "row" | "header" | "list";
  /** On a selected row the pale tile would sink into the selected wash; it goes solid. */
  active?: boolean;
  /** The room's own colour (see identityTint): a solid tile, so rooms tell apart at a glance. */
  tint?: Tint;
  /** A group's uploaded photo, drawn instead of the tile. */
  imageUrl?: string;
}) {
  return (
    <ChatRoomPhoto src={imageUrl} className={PHOTO_SIZE[size]}>
      <IconTile
        icon={icon}
        tone={tint ?? moduleTone("chat")}
        variant={tint || active ? "solid" : "soft"}
        size={size === "list" ? "lg" : size === "header" ? "md" : "sm"}
        className={cn(size === "row" && "size-8")}
      />
    </ChatRoomPhoto>
  );
}
