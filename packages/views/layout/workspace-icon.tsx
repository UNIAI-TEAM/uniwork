"use client";

import { useState } from "react";
import type { Workspace } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * A workspace's face: its uploaded image, else its emoji, else the first
 * letter of its name (spec 2026-10-14 §6.3). The caller owns size, shape and
 * colours through className, so each surface keeps the tile it had.
 * Decorative: every caller names the workspace in text or an aria-label.
 */
export function WorkspaceIcon({
  workspace,
  className,
  fallback,
}: {
  workspace: Pick<Workspace, "name" | "icon_emoji" | "icon_url">;
  className?: string;
  /** Text drawn when there is no image or emoji; the first letter of the name by default. */
  fallback?: string;
}) {
  // The URL that failed to load, so a new URL gets its own chance.
  const [broken, setBroken] = useState<string | null>(null);
  const url = workspace.icon_url && workspace.icon_url !== broken ? workspace.icon_url : "";
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center overflow-hidden", className)}>
      {url ? (
        <img src={url} alt="" className="size-full object-cover" onError={() => setBroken(url)} />
      ) : workspace.icon_emoji ? (
        <span className="leading-none">{workspace.icon_emoji}</span>
      ) : (
        // Array.from keeps a surrogate pair (an emoji first letter) whole.
        (fallback ?? (Array.from(workspace.name.trim())[0] ?? "").toUpperCase())
      )}
    </span>
  );
}
