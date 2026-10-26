"use client";

import { useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiPanelStore } from "@uniwork/core/ai";
import { useAiMemory } from "@uniwork/core/ai/memory";

/**
 * "Dùng N mục bộ nhớ": a chip under an answer, like ClickUp's memory chip, that unfolds the entries the answer was
 * written with, read live, so a deleted one drops out (all deleted: the line says so).
 */
export function AskUniMemoryUsed({ memoryIds, orgSlug }: { memoryIds: string[]; orgSlug: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.memory.used" });
  const setView = useAiPanelStore((s) => s.setView);
  const memory = useAiMemory(orgSlug);
  const [open, setOpen] = useState(false);
  if (memoryIds.length === 0 || !memory.data) return null;
  const live = memoryIds.flatMap((id) => memory.data.entries.filter((e) => e.id === id));
  const line = "flex items-center gap-1.5 text-caption text-muted-foreground";
  if (live.length === 0) {
    return (
      <p className={line}>
        <Brain aria-hidden className="size-3.5 shrink-0" />
        {t("deleted")}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-caption text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
      >
        <Brain aria-hidden className="size-3.5 shrink-0" />
        {t("chip", { count: live.length })}
        <ChevronDown aria-hidden className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="flex flex-col gap-0.5 ps-2">
          <ul aria-label={t("list")} className="flex flex-col gap-0.5">
            {live.map((e) => (
              <li key={e.id}>
                <button type="button" className="text-left text-caption text-foreground hover:underline" onClick={() => setView("memory")}>
                  {e.text}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="self-start text-caption text-primary hover:underline" onClick={() => setView("memory")}>
            {t("open")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
