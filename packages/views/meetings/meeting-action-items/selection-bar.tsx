"use client";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { UserRoundCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

/**
 * The room's floating bar while the clerk has items ticked: how many, clear,
 * and "Assign N items" (the list's own assign). It sits where the composer
 * does, which the shell hides meanwhile, and leaves once nothing is ticked.
 */
export function ActionItemsSelectionBar({
  count,
  busy,
  onClear,
  onAssign,
  fallbackFocus,
}: {
  count: number;
  busy: boolean;
  onClear: () => void;
  onAssign: () => void;
  /** Where focus goes when the bar leaves while it holds focus (assigned or cleared). */
  fallbackFocus: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  // A layout cleanup runs before the bar leaves the DOM, while its button still has focus.
  useLayoutEffect(() => {
    const bar = ref.current;
    // Read at cleanup on purpose: the node to land on then, not when the bar came.
    const fallback = fallbackFocus;
    return () => {
      if (bar?.contains(document.activeElement)) fallback.current?.focus();
    };
  }, [fallbackFocus]);
  return (
    <div
      ref={ref}
      className="sticky bottom-3 z-10 flex items-center gap-2 rounded-2xl bg-foreground py-2 pr-2 pl-3.5 text-background shadow-lg"
    >
      <span className="text-label font-semibold tabular-nums">{t("meetings.panel.actions.selected", { count })}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 text-background/80 hover:bg-background/10 hover:text-background"
        onClick={onClear}
      >
        {t("meetings.panel.actions.clear")}
      </Button>
      <Button
        type="button"
        size="lg"
        className="ml-auto rounded-[11px] bg-background font-semibold text-foreground hover:bg-background/90"
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        onClick={onAssign}
      >
        {busy ? <Spinner data-icon="inline-start" /> : <UserRoundCheck aria-hidden data-icon="inline-start" />}
        {t("meetings.actionItemsSection.assign", { count })}
      </Button>
    </div>
  );
}
