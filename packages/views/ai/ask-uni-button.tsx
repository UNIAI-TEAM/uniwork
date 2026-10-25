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
 * AI pill inside the search field, after ClickUp's "AI Chats": the UNI mark and the name inside a ring drawn from the
 * brand gradient, which spins while the pill is hovered or focused. Without it, an icon in the cluster.
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
                ? // isolate: the ring and its cover sit under the label but above the button's own (transparent) fill.
                  "group/ai relative isolate h-6 gap-1.5 overflow-hidden rounded-full bg-transparent px-2.5 text-caption font-medium text-foreground hover:bg-transparent dark:hover:bg-transparent"
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
            {/* A square of the conic gradient, larger than the pill, centred on it: its 1px rim shows past the cover. */}
            <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-full">
              <span
                data-slot="ask-uni-ring"
                className="absolute top-1/2 left-1/2 size-40 -translate-1/2 bg-[conic-gradient(var(--brand),var(--brand-accent),var(--brand-subtle-foreground),var(--brand))] motion-safe:group-hover/ai:animate-[spin_1.5s_linear_infinite] motion-safe:group-focus-visible/ai:animate-[spin_1.5s_linear_infinite]"
              />
            </span>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-px -z-10 rounded-full bg-page-canvas transition-[inset] group-hover/ai:inset-[1.5px] group-focus-visible/ai:inset-[1.5px]"
            />
            <Logo variant="mark" size={11} decorative />
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
