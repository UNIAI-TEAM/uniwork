"use client";

import { useTranslation } from "react-i18next";

/** Read-only questions UNI suggests after its last answer; a click sends one at once. */
export function AskUniFollowups({ items, onAsk }: { items: string[]; onAsk: (q: string) => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.followups" });
  if (items.length === 0) return null;
  return (
    <li className="flex flex-col gap-1.5">
      <p className="text-caption text-muted-foreground">{t("label")}</p>
      <div className="flex flex-col items-start gap-1.5">
        {items.map((q, i) => (
          <button
            key={`${i}:${q}`}
            type="button"
            aria-label={q}
            onClick={() => onAsk(q)}
            className="rounded-md border border-border px-2.5 py-1.5 text-left text-body text-foreground hover:bg-surface-hover"
          >
            {q}
          </button>
        ))}
      </div>
    </li>
  );
}
