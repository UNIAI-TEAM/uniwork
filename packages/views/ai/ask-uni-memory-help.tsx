"use client";

import { Brain, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiPanelStore } from "@uniwork/core/ai";
import { useAiMemory } from "@uniwork/core/ai/memory";
import { Button } from "@uniwork/ui/components/ui/button";

const STARTERS = ["remember", "name", "role", "forget"] as const;

/**
 * "Sửa bằng cách nói với UNI": a strip above the composer, in ClickUp's spirit of a guided start, that says what UNI
 * remembers and offers starters. A starter only fills the composer: nothing is sent, so no answer is invented and no
 * model call is spent until the person writes the rest. Sending closes the strip (the panel does it).
 */
export function AskUniMemoryHelp({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.memory.help" });
  const memory = useAiMemory(orgSlug);
  const setMemoryHelp = useAiPanelStore((s) => s.setMemoryHelp);
  const setPrefill = useAiPanelStore((s) => s.setComposerPrefill);
  const entries = memory.data?.entries ?? [];
  const preference = entries.filter((e) => e.kind === "preference").length;
  const starters = entries.length === 0 ? STARTERS.filter((s) => s !== "forget") : STARTERS;
  return (
    <section aria-label={t("region")} className="mx-3 mb-2 rounded-xl border border-border bg-card px-3 py-2.5" data-slot="ask-uni-memory-help">
      <div className="flex items-start gap-2">
        <Brain aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="flex-1 text-caption text-muted-foreground">
          {entries.length === 0
            ? t("empty")
            : t("summary", { count: entries.length, preference, fact: entries.length - preference })}
        </p>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t("close")} onClick={() => setMemoryHelp(false)}>
          <X aria-hidden />
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {starters.map((s) => (
          <Button key={s} type="button" variant="outline" size="xs" onClick={() => setPrefill(t(`${s}_text`))}>
            {t(`${s}_label`)}
          </Button>
        ))}
      </div>
    </section>
  );
}
