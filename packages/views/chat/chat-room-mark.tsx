"use client";

import type { LucideIcon } from "lucide-react";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { moduleTone } from "../layout/module-tones";

/**
 * The mark of a room that is not a person — the workspace room, a group, a
 * channel. Rooms wear the chat tint; the glyph says which kind of room it is.
 * `row` matches a 32px avatar in the list, `header` a 40px one.
 */
export function ChatRoomMark({
  icon,
  size = "row",
  active = false,
}: {
  icon: LucideIcon;
  size?: "row" | "header";
  /** On a selected row the pale tile would sink into the selected wash; it goes solid. */
  active?: boolean;
}) {
  return (
    <IconTile
      icon={icon}
      tone={moduleTone("chat")}
      variant={active ? "solid" : "soft"}
      size={size === "header" ? "md" : "sm"}
      className={cn(size === "row" && "size-8")}
    />
  );
}
