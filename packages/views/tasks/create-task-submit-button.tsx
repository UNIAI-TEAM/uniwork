"use client";

import type { ComponentProps } from "react";
import type { ShortcutChord } from "@uniwork/core/shortcuts";
import { Button } from "@uniwork/ui/components/ui/button";
import { ShortcutKeycaps } from "../editor/shortcut-keycaps";

type CreateTaskSubmitButtonProps = {
  label: string;
  shortcut: ShortcutChord | null;
  inactive: boolean;
  busy: boolean;
  type: "button" | "submit";
  onClick?: ComponentProps<typeof Button>["onClick"];
};

/** Shared submit chrome keeps manual and agent composers visually identical. */
export function CreateTaskSubmitButton({
  label,
  shortcut,
  inactive,
  busy,
  type,
  onClick,
}: CreateTaskSubmitButtonProps) {
  return (
    <Button
      type={type}
      size="sm"
      disabled={busy}
      aria-disabled={!busy && inactive ? true : undefined}
      aria-busy={busy || undefined}
      className="min-w-28 justify-self-end gap-2"
      onClick={onClick}
    >
      {label}
      {!busy && shortcut ? (
        <ShortcutKeycaps
          shortcut={shortcut}
          decorative
          className="ml-1 max-sm:hidden"
          keyClassName="border-background/30 bg-background/15 text-primary-foreground shadow-none"
        />
      ) : null}
    </Button>
  );
}
