"use client";

import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchStore } from "@uniwork/core/search";
import { SidebarMenuButton } from "@uniwork/ui/components/ui/sidebar";
import { cn } from "@uniwork/ui/lib/utils";

function shortcutLabel(t: (key: string) => string) {
  if (typeof navigator === "undefined") return t("topbar.shortcutOther");
  const platform = navigator.platform ?? "";
  const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
  return isMac ? t("topbar.shortcutMac") : t("topbar.shortcutOther");
}

/** Opens the command palette — lives in the sidebar like the reference shell. */
export function SearchTrigger({ className }: { className?: string }) {
  const { t } = useTranslation();
  const label = t("topbar.search");
  return (
    <SidebarMenuButton
      tooltip={label}
      className={cn("text-muted-foreground", className)}
      onClick={() => useSearchStore.getState().setOpen(true)}
    >
      <Search aria-hidden />
      <span>{label}</span>
      <kbd className="pointer-events-none ml-auto hidden rounded border border-sidebar-border bg-sidebar-accent px-1.5 font-sans text-[10px] font-normal text-muted-foreground sm:inline">
        {shortcutLabel(t)}
      </kbd>
    </SidebarMenuButton>
  );
}
