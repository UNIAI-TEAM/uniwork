"use client";

import type { LucideIcon } from "lucide-react";
import { IconTile, type Tint } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { moduleTone } from "../layout/module-tones";

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
}: {
  icon: LucideIcon;
  size?: "row" | "header" | "list";
  /** On a selected row the pale tile would sink into the selected wash; it goes solid. */
  active?: boolean;
  /** The room's own colour (see identityTint): a solid tile, so rooms tell apart at a glance. */
  tint?: Tint;
}) {
  return (
    <IconTile
      icon={icon}
      tone={tint ?? moduleTone("chat")}
      variant={tint || active ? "solid" : "soft"}
      size={size === "list" ? "lg" : size === "header" ? "md" : "sm"}
      className={cn(size === "row" && "size-8")}
    />
  );
}
