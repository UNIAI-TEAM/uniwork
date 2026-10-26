"use client";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * The signature time chip (kit `.chip-time`): the wall clock in mono, a
 * hover fill, the selected wash while its popover is open (`aria-expanded`),
 * and a hit area grown to 44 vertically without growing the glyph.
 * Presentational: the evidence popover wraps it as its trigger, so every other
 * prop (aria-expanded, onClick, ref) is passed through. `ariaLabel` is the
 * full name ("Xem căn cứ lúc 09:06, 4 căn cứ").
 */
export function TimeChipButton({
  time,
  ariaLabel,
  className,
  type = "button",
  ...props
}: Omit<ComponentProps<"button">, "children"> & { time: string; ariaLabel: string }) {
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      {...props}
      className={cn(
        "relative inline-flex h-5 items-center rounded-sm px-1.5 py-0.5 font-mono text-caption font-medium whitespace-nowrap text-muted-foreground tabular-nums before:absolute before:-inset-x-0.5 before:-inset-y-3 hover:bg-surface-hover hover:text-foreground active:bg-muted aria-expanded:bg-surface-selected aria-expanded:text-brand-subtle-foreground",
        className,
      )}
    >
      {time}
    </button>
  );
}

/** "+3" after a row's text (kit `.more-ev`): hidden from screen readers, whose count is in the chip's label. */
export function TimeChipMore({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <span aria-hidden className="ml-1 text-caption whitespace-nowrap text-muted-foreground">
      {t("meetings.moreParticipantsShort", { count })}
    </span>
  );
}
