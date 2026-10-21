"use client";

import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities, useAiPanelStore } from "@uniwork/core/ai";
import { ariaKeyShortcuts, formatShortcut, useShortcut } from "@uniwork/core/shortcuts";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { useWorkspace } from "../layout/workspace-context";

/** Top-bar "Hỏi UNI". Renders nothing while the server has no provider (spec §3.2). */
export function AskUniButton() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const caps = useAiCapabilities(workspace.id);
  const chord = useShortcut("ai.askUni");
  const toggle = useAiPanelStore((s) => s.toggle);
  if (!caps.data?.enabled) return null;
  // The name is the plain command; the chord is the tooltip hint and aria-keyshortcuts.
  const tooltip = t("topbar.askUni", { shortcut: formatShortcut(chord) });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button type="button" variant="ghost" size="icon" className="text-muted-foreground" aria-label={t("topbar.askUniName")} aria-keyshortcuts={ariaKeyShortcuts(chord)} onClick={toggle} />
        }
      >
        <Sparkles aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
