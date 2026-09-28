"use client";

import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchStore } from "@uniwork/core/search";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

function shortcutLabel(t: (key: string) => string) {
  if (typeof navigator === "undefined") return t("topbar.shortcutOther");
  const platform = navigator.platform ?? "";
  const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
  return isMac ? t("topbar.shortcutMac") : t("topbar.shortcutOther");
}

/**
 * Opens the command palette from the top bar. Looks like a search field but is
 * a button: typing happens in the palette, not here. Collapses to an icon
 * below `sm`.
 */
export function SearchTrigger({ className }: { className?: string }) {
  const { t } = useTranslation();
  const label = t("topbar.search");
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={label}
      className={cn(
        "h-8 w-8 justify-center gap-2 border-transparent bg-surface-hover/60 px-0 font-normal text-muted-foreground hover:bg-surface-hover hover:text-foreground sm:w-64 sm:justify-start sm:pr-2 sm:pl-2.5 dark:hover:bg-surface-hover",
        className,
      )}
      onClick={() => useSearchStore.getState().setOpen(true)}
    >
      <Search aria-hidden strokeWidth={1.75} className="size-4" />
      <span className="hidden sm:inline">{label}</span>
      <kbd className="pointer-events-none ml-auto hidden font-sans text-caption font-medium text-muted-foreground sm:inline-flex">
        {shortcutLabel(t)}
      </kbd>
    </Button>
  );
}
