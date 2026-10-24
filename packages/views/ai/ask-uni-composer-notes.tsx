"use client";

import { Gauge, ShieldAlert, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAskUniMode } from "./ask-uni-mode-button";
import { useAskModelSelection } from "./ask-uni-model-picker";

/**
 * The composer's standing notes — Tự động held back in a tainted conversation, Opus's quota — as one quiet strip
 * tucked on top of the box, one line each with its glyph, instead of lines wedged between the box's buttons.
 */
export function AskUniComposerNotes({ wsId, tainted }: { wsId: string; tainted: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const mode = useAskUniMode(wsId)?.mode;
  const { model } = useAskModelSelection(wsId);
  const notes: { key: string; Icon: LucideIcon; text: string }[] = [];
  if (tainted && mode === "auto") notes.push({ key: "tainted", Icon: ShieldAlert, text: t("mode.tainted_note") });
  if (model === "opus") notes.push({ key: "opus", Icon: Gauge, text: t("model.opus_note") });
  if (notes.length === 0) return null;
  return (
    <div
      role="status"
      data-slot="ask-uni-composer-notes"
      // Inset past the frame's corner radius so the strip reads as a tab on the box's top edge.
      className="mx-4 flex flex-col gap-1 rounded-t-lg border border-b-0 border-border bg-muted/60 px-2.5 py-1.5 text-caption text-muted-foreground"
    >
      {notes.map(({ key, Icon, text }) => (
        <p key={key} className="flex items-start gap-1.5">
          <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
          {text}
        </p>
      ))}
    </div>
  );
}
