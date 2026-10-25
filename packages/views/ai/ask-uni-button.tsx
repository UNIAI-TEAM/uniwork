"use client";

import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities, useAiPanelStore } from "@uniwork/core/ai";
import { ariaKeyShortcuts, formatShortcut, useShortcut } from "@uniwork/core/shortcuts";
import { Logo } from "@uniwork/ui/brand";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { useWorkspace } from "../layout/workspace-context";

/**
 * Top-bar "Hỏi UNI". Renders nothing while the server has no provider (spec §3.2). `labeled` is the desktop bar's
 * AI pill (the UNI mark and the name on the brand tint, like ClickUp's AI entry); without it, an icon in the cluster.
 */
export function AskUniButton({ labeled = false }: { labeled?: boolean }) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const caps = useAiCapabilities(workspace.id);
  const chord = useShortcut("ai.askUni");
  const toggle = useAiPanelStore((s) => s.toggle);
  if (!caps.data?.enabled) return null;
  // The name is the plain command; the chord is the tooltip hint and aria-keyshortcuts.
  const name = t("topbar.askUniName");
  const tooltip = t("topbar.askUni", { shortcut: formatShortcut(chord) });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size={labeled ? "sm" : "icon"}
            className={
              labeled
                ? "h-8 gap-1.5 rounded-full bg-brand-subtle px-3 font-medium text-brand-subtle-foreground ring-1 ring-brand/25 hover:bg-brand-subtle hover:text-brand-subtle-foreground hover:ring-brand/60 dark:hover:bg-brand-subtle"
                : "text-muted-foreground"
            }
            aria-label={name}
            aria-keyshortcuts={ariaKeyShortcuts(chord)}
            onClick={toggle}
          />
        }
      >
        {labeled ? (
          <>
            <Logo variant="mark" size={12} decorative />
            {name}
          </>
        ) : (
          <Sparkles aria-hidden />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
