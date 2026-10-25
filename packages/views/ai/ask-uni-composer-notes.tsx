"use client";

import { useState } from "react";
import { Gauge, Minimize2, ShieldAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAskModelChoice } from "@uniwork/core/ai/model-choice";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { useAskUniMode } from "./ask-uni-mode-button";
import { useAskModelSelection } from "./ask-uni-model-picker";

/** Folding the notes lasts a day; after it they show again by themselves. */
const FOLD_MS = 24 * 60 * 60 * 1000;

/** The notes that stand right now, and whether the asker folded them within the last day. */
function useComposerNotes(wsId: string, tainted: boolean) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const mode = useAskUniMode(wsId)?.mode;
  const { model } = useAskModelSelection(wsId);
  const hiddenUntil = useAskModelChoice((s) => s.notesHiddenUntil);
  // Read once per mount: a fold that runs out shows the notes on the next visit, not mid-sentence.
  const [now] = useState(Date.now);
  const notes: { key: string; Icon: LucideIcon; text: string }[] = [];
  if (tainted && mode === "auto") notes.push({ key: "tainted", Icon: ShieldAlert, text: t("mode.tainted_note") });
  if (model === "opus") notes.push({ key: "opus", Icon: Gauge, text: t("model.opus_note") });
  return { notes, folded: hiddenUntil > now };
}

/**
 * The composer's standing notes — Tự động held back in a tainted conversation, Opus's quota — as one quiet strip
 * tucked on top of the box, one line each with its glyph. The asker can fold it for a day into
 * {@link AskUniComposerNotesSign}.
 */
export function AskUniComposerNotes({ wsId, tainted }: { wsId: string; tainted: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.notes" });
  const { notes, folded } = useComposerNotes(wsId, tainted);
  const hide = useAskModelChoice((s) => s.hideNotes);
  if (notes.length === 0 || folded) return null;
  return (
    <div
      role="status"
      data-slot="ask-uni-composer-notes"
      // Inset past the frame's corner radius so the strip reads as a tab on the box's top edge.
      className="mx-4 flex items-start gap-1 rounded-t-lg border border-b-0 border-border bg-muted/60 py-1.5 ps-2.5 pe-1 text-caption text-muted-foreground"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {notes.map(({ key, Icon, text }) => (
          <p key={key} className="flex items-start gap-1.5">
            <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
            {text}
          </p>
        ))}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={<Button type="button" variant="ghost" size="icon-xs" className="-my-0.5 shrink-0 text-muted-foreground" onClick={() => hide(Date.now() + FOLD_MS)} />}
          aria-label={t("hide")}
        >
          <Minimize2 aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="top">{t("hide")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** The folded notes: a warning sign in the box's top-right corner that opens them again. Place it in the frame. */
export function AskUniComposerNotesSign({ wsId, tainted }: { wsId: string; tainted: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.notes" });
  const { notes, folded } = useComposerNotes(wsId, tainted);
  const show = useAskModelChoice((s) => s.showNotes);
  if (notes.length === 0 || !folded) return null;
  const label = t("show", { count: notes.length });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-slot="ask-uni-composer-notes-sign"
            // Inside the frame's top-right corner; the composer pads the editor's lines clear of it. Orange in both
            // themes (the owner's call); the warning signal reads amber on dark and brown on light.
            className="absolute top-2 right-2 z-10 text-tint-orange-foreground hover:text-tint-orange-foreground"
            onClick={show}
          />
        }
        aria-label={label}
      >
        <TriangleAlert aria-hidden className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
