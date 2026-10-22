"use client";

import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";

const KINDS = ["task", "project", "meeting", "document", "room"];
const QUESTIONS = [1, 2, 3, 4];

/** The empty panel: the UNI mark, the title and four fixed read-only questions for the open page. A click asks at once. */
export function AskUniEmptyState({ kind, onAsk, disabled = false }: { kind: string | null; onAsk: (q: string) => void; disabled?: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.empty" });
  // Members and page kinds without a set (threads, messages) share the general questions.
  const set = kind && KINDS.includes(kind) ? kind : "other";
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-4 py-6" data-slot="ask-uni-empty">
      <Logo variant="mark" size={40} decorative />
      <h2 className="text-title font-medium text-foreground">{t("title")}</h2>
      <div className="flex w-full flex-col items-stretch gap-1.5">
        {QUESTIONS.map((n) => {
          const q = t(`${set}.${n}`);
          return (
            <button
              key={n}
              type="button"
              aria-disabled={disabled || undefined}
              onClick={disabled ? undefined : () => onAsk(q)}
              className="rounded-md border border-border px-2.5 py-1.5 text-left text-body text-foreground hover:bg-surface-hover"
            >
              {q}
            </button>
          );
        })}
      </div>
    </div>
  );
}
