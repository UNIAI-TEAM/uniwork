"use client";

import { ChevronDown, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities } from "@uniwork/core/ai";
import { useSetAskUniMode } from "@uniwork/core/ai/proposals";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";

/** Weakest first: a ceiling allows its own rank and every one below it. */
const MODES = ["ask", "plan", "auto"] as const;

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
  if (!state) return null;
  const current = t(state.mode);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={save.isPending}
          render={<Button type="button" variant="ghost" size="sm" className="text-muted-foreground" aria-label={t("label_with", { mode: current })} />}
        >
          {/* The model picker beside it can also read "Tự động"; the shield marks this one as permissions. */}
          <ShieldCheck aria-hidden />
          {current}
          <ChevronDown aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="min-w-48">
          <DropdownMenuRadioGroup
            value={state.mode}
            onValueChange={(next) => {
              if (next !== state.mode) save.mutate(String(next));
            }}
          >
            {state.allowed.map((m) => (
              <DropdownMenuRadioItem key={m} value={m}>
                {t(m)}
              </DropdownMenuRadioItem>
            ))}
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
