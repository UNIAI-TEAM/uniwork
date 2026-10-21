"use client";

import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities, useAiPanelStore } from "@uniwork/core/ai";
import { useFlag } from "@uniwork/core/feature-flags";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { useOptionalWorkspace } from "../layout/workspace-context";

type AskUniFocus = Parameters<ReturnType<typeof useAiPanelStore.getState>["openWithFocus"]>[0];
type FocusKind = "task" | "meeting" | "document" | "project" | "room";

/**
 * Opens the docked Ask UNI panel with this object as its focus, or undefined
 * while the dock is off (flag), the server has no provider, or there is no workspace.
 */
export function useAskUniOpener(focus: AskUniFocus, workspaceId?: string): (() => void) | undefined {
  const docked = useFlag("ask_uni_stream", false);
  const fromContext = useOptionalWorkspace()?.workspace.id;
  const wsId = workspaceId ?? fromContext ?? "";
  const caps = useAiCapabilities(wsId, docked && wsId !== "");
  if (!docked || !caps.data?.enabled) return undefined;
  return () => useAiPanelStore.getState().openWithFocus(focus);
}

/** Icon button "Hỏi UNI về <object>" for a detail screen's header. */
export function AskUniFocusButton({ kind, id, title, workspaceId }: { kind: FocusKind; id: string; title?: string; workspaceId?: string }) {
  const { t } = useTranslation();
  const open = useAskUniOpener({ kind, id, label: title }, workspaceId);
  if (!open) return null;
  const label = t(`ai.ask_about_${kind}`);
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={label} onClick={open} />}
      >
        <Sparkles aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
