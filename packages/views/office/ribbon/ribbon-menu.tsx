"use client";

import { Check } from "lucide-react";
import { DropdownMenuContent, DropdownMenuItem } from "@uniwork/ui/components/ui/dropdown-menu";
import type { RibbonMenuEntry } from "./types";

/** Marks portalled ribbon popups so the peek overlay ignores presses in them. */
export const RIBBON_PORTAL_ATTR = { "data-ribbon-portal": "" } as const;

export type MenuEntry = Omit<RibbonMenuEntry, "labelKey"> & { label: string };

export function MenuEntries({ entries }: { entries: readonly MenuEntry[] }) {
  return (
    <DropdownMenuContent className="min-w-44" {...RIBBON_PORTAL_ATTR}>
      {entries.map(({ id, label, icon: Icon, disabled, checked, onSelect }) => (
        <DropdownMenuItem key={id} disabled={disabled} onClick={onSelect} data-ribbon-menu-entry={id}>
          {Icon ? <Icon aria-hidden /> : null}
          <span className="flex-1">{label}</span>
          {checked ? <Check aria-hidden className="size-3.5" /> : null}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}
