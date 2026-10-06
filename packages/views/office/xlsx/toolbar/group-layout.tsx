"use client";

import type { ComponentProps, ReactNode } from "react";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * F3/F4 (UNI-926 FRAME): Office group anatomy for the XLSX groups. Every XLSX
 * group mounts as ONE custom ribbon item, so the group lays out its own
 * controls: an optional LARGE primary command (32px icon over a 2-line label)
 * followed by compact rows of 24px icon buttons. These helpers keep that
 * anatomy identical across groups and match the shared ribbon's own sizes.
 */

/** The group body: [large primary] [rows]. Fills the ribbon body height. */
export function XlsxGroupBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex h-full min-h-0 items-stretch gap-1", className)}>{children}</div>;
}

/** 2-3 compact rows of icon controls, top aligned like the ribbon's strips. */
export function XlsxGroupRows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex shrink-0 flex-col justify-start gap-0.5", className)}>{children}</div>;
}

/** One row inside `XlsxGroupRows`. */
export function XlsxGroupRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-0.5", className)}>{children}</div>;
}

/** Excel's boxed inline fields (font family, font size, number format,
 *  rotation): one 24px bordered box, whatever primitive sits inside. */
export const XLSX_FIELD_BOX_CLASS =
  "h-6 shrink-0 overflow-hidden rounded-sm border border-input bg-background pointer-coarse:h-11 [&_[data-slot=select-trigger]]:h-full [&_[data-slot=select-trigger]]:w-full [&_[data-slot=select-trigger]]:rounded-none [&_[data-slot=select-trigger]]:border-0 [&_[data-slot=select-trigger]]:py-0 [&_[data-slot=select-trigger]]:pr-1 [&_[data-slot=select-trigger]]:pl-1.5 [&_[data-slot=select-trigger]]:text-caption";

/** Class for a compact 24px icon button inside a row (matches ribbon `icon`). */
export const XLSX_ICON_BUTTON_CLASS = "size-6 p-0 [&_svg:not([class*='size-'])]:size-4";

/** Class for a compact icon + label button (matches ribbon `small`). */
export const XLSX_SMALL_BUTTON_CLASS = "h-6 justify-start gap-1.5 px-1.5 text-caption font-normal";

/** Class for the LARGE primary button (matches ribbon `large`). */
export const XLSX_LARGE_BUTTON_CLASS =
  "h-auto min-w-12 max-w-24 flex-col justify-start gap-0.5 self-stretch px-1.5 py-0.5 text-caption font-normal whitespace-normal [&_svg:not([class*='size-'])]:size-7";

/** The LARGE primary command of a group: 32px icon over a 2-line label. Pass
 *  the icon and the visible label as children; aria/testid props flow through
 *  so existing tests keep their handles. Works as a PopoverTrigger render. */
export function XlsxLargeButton({ className, children, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button type="button" variant="ghost" className={cn(XLSX_LARGE_BUTTON_CLASS, className)} {...props}>
      {children}
    </Button>
  );
}

/** The 2-line label under a large icon. */
export function XlsxLargeLabel({ children }: { children: ReactNode }) {
  return <span className="line-clamp-2 text-center leading-tight pb-px">{children}</span>;
}
