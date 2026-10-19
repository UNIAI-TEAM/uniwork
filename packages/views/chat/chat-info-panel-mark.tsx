"use client";

import type { LucideIcon } from "lucide-react";
import { tintSolidClass, type Tint } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { roomInitialsOf } from "./chat-initials";
import { ChatRoomPhoto } from "./chat-room-mark";

const FACE_SIZE = {
  // The header's 42px squircle, the settings hero's 68px one and the info panel's 84px one.
  header: "size-10.5 rounded-[14px] text-body-lg font-bold [&_svg]:size-5",
  sheet: "size-17 rounded-2xl text-display-sm font-extrabold [&_svg]:size-8",
  // The create-group dialog's 72px tile.
  create: "size-18 rounded-[22px] text-display-sm font-extrabold [&_svg]:size-8",
  panel: "size-21 rounded-[26px] text-display-sm font-extrabold [&_svg]:size-9",
} as const;

/**
 * A room that is not a person: its uploaded photo, else a solid squircle in
 * the room's colour with its glyph (workspace room, channel) or its initials
 * (a group) — the same face the conversation list draws. Decorative — the room's name always sits beside it.
 */
export function ChatRoomFace({
  name,
  tint,
  icon: Icon,
  text,
  imageUrl,
  size,
}: {
  name: string;
  tint: Tint;
  icon?: LucideIcon;
  /** A glyph in place of the initials (a public channel's "#", as the list draws it). */
  text?: string;
  imageUrl?: string;
  size: keyof typeof FACE_SIZE;
}) {
  return (
    <ChatRoomPhoto src={imageUrl} className={FACE_SIZE[size]}>
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center font-display",
          tintSolidClass[tint],
          FACE_SIZE[size],
        )}
      >
        {Icon ? <Icon /> : (text ?? roomInitialsOf(name))}
      </span>
    </ChatRoomPhoto>
  );
}
