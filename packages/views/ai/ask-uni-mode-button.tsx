"use client";

import { useId } from "react";
import { ChevronDown, ListChecks, MessageCircleQuestionMark, Zap, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities } from "@uniwork/core/ai";
import { useSetAskUniMode } from "@uniwork/core/ai/proposals";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";

/** Weakest first: a ceiling allows its own rank and every one below it. */
const MODES = ["ask", "plan", "auto"] as const;

/** One glyph per mode, on the trigger and in the menu: it also keeps this apart from the model picker's "Tự động". */
const MODE_ICONS: Record<(typeof MODES)[number], LucideIcon> = { ask: MessageCircleQuestionMark, plan: ListChecks, auto: Zap };

/**
 * The mode Ask UNI works in, or null when the member has no say: actions off, or the organization's ceiling is
 * `off`. The server already clamped `mode` to the ceiling; an unknown or empty one reads as the weakest.
 */
export function useAskUniMode(wsId: string) {
  const actions = useAiCapabilities(wsId).data?.actions;
  const rank = MODES.indexOf(actions?.ceiling as (typeof MODES)[number]);
  if (!actions?.enabled || rank < 0) return null;
  const mode = MODES.find((m) => m === actions.mode) ?? "ask";
  return { mode, allowed: MODES.slice(0, rank + 1) };
}

/** Choose how Ask UNI's changes are approved: ask first, as one plan, or (safe ones) by themselves. */
export function AskUniModeButton({ wsId, conversationTainted }: { wsId: string; conversationTainted: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.mode" });
  const state = useAskUniMode(wsId);
  const save = useSetAskUniMode(wsId);
  const id = useId();
  if (!state) return null;
  const current = t(state.mode);
  const CurrentIcon = MODE_ICONS[state.mode];
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={save.isPending}
          render={<Button type="button" variant="ghost" size="sm" className="text-muted-foreground" aria-label={t("label_with", { mode: current })} />}
        >
          <CurrentIcon aria-hidden />
          {current}
          <ChevronDown aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-80">
          <DropdownMenuRadioGroup
            value={state.mode}
            onValueChange={(next) => {
              if (next !== state.mode) save.mutate(String(next));
            }}
          >
            <DropdownMenuLabel>{t("menu_title")}</DropdownMenuLabel>
            {state.allowed.map((m) => {
              const Icon = MODE_ICONS[m];
              return (
                // The title names the item; the hint describes it, so a screen reader hears both apart.
                <DropdownMenuRadioItem key={m} value={m} className="items-start gap-2.5 py-1.5" aria-labelledby={`${id}-${m}`} aria-describedby={`${id}-${m}-hint`}>
                  <Icon aria-hidden className="mt-0.5 text-muted-foreground" />
                  <span className="flex min-w-0 flex-col">
                    <span id={`${id}-${m}`}>{t(m)}</span>
                    <span id={`${id}-${m}-hint`} className="text-caption text-muted-foreground">
                      {t(`${m}_hint`)}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {save.isError ? (
        <p role="alert" className="order-last basis-full text-caption text-destructive">
          {t("save_failed")}
        </p>
      ) : null}
      {conversationTainted && state.mode === "auto" ? (
        <p role="status" className="order-last basis-full text-caption text-muted-foreground">
          {t("tainted_note")}
        </p>
      ) : null}
    </>
  );
}
