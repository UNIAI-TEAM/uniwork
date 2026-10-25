"use client";

import { useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiPanelStore } from "@uniwork/core/ai";
import { useAiMemory } from "@uniwork/core/ai/memory";

/** "Đã dùng bộ nhớ": the entries an answer was written with, read live, so a deleted one shows as deleted. */
export function AskUniMemoryUsed({ memoryIds, orgId }: { memoryIds: string[]; orgId: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.memory.used" });
  const setView = useAiPanelStore((s) => s.setView);
  const memory = useAiMemory(orgId);
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
  const [first, ...rest] = live;
  return (
    <div className="flex flex-col gap-1">
      <div className={line}>
        <Brain aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{t("label", { text: first!.text })}</span>
        {rest.length > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={t("more", { count: rest.length })}
            className="inline-flex items-center rounded px-1 hover:bg-muted"
            onClick={() => setOpen((o) => !o)}
          >
            {t("more", { count: rest.length })}
            <ChevronDown aria-hidden className="size-3" />
          </button>
        ) : null}
      </div>
      {open ? (
        <ul aria-label={t("list")} className="flex flex-col gap-0.5 pl-5">
          {live.map((e) => (
            <li key={e.id}>
              <button type="button" className="text-left text-caption text-foreground hover:underline" onClick={() => setView("memory")}>
                {e.text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
