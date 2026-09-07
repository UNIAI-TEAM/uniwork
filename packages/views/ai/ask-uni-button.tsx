"use client";

import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities, useAiPanelStore } from "@uniwork/core/ai";
import { formatShortcut, useShortcut } from "@uniwork/core/shortcuts";
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
  const label = t("topbar.askUni", { shortcut: formatShortcut(chord) });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button type="button" variant="ghost" size="icon-sm" className="h-8 w-8" aria-label={label} onClick={toggle} />
        }
      >
        <Sparkles aria-hidden className="size-4 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
