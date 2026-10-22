"use client";

import { useTranslation } from "react-i18next";
import { AskUniProviderMark, type AskLook } from "./ask-uni-provider";

const KINDS = ["task", "project", "meeting", "document", "room"];
const QUESTIONS = [1, 2, 3, 4];

/**
 * The empty panel: the picked model's mark and welcome (UNI's for Auto, the provider's for a model with a look, as
 * ClickUp Brain does), then four fixed read-only questions for the open page. A click asks at once.
 */
export function AskUniEmptyState({
  kind,
  onAsk,
  disabled = false,
  model = "",
  look = null,
}: {
  kind: string | null;
  onAsk: (q: string) => void;
  disabled?: boolean;
  model?: string;
  look?: AskLook | null;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  // Members and page kinds without a set (threads, messages) share the general questions.
  const set = kind && KINDS.includes(kind) ? kind : "other";
  const branded = look !== null && model !== "";
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-4 py-6" data-slot="ask-uni-empty">
      <AskUniProviderMark look={branded ? look : null} size={branded ? 36 : 48} />
      <div className="flex flex-col items-center gap-1 text-center">
        <h2 className="text-title font-medium text-foreground">{t(branded ? `empty.title_${look}` : "empty.title")}</h2>
        <p className="text-body text-muted-foreground">
          {branded ? t(`models.${model}.description`, { defaultValue: "" }) : t("model.auto_description")}
        </p>
      </div>
      <div className="flex w-full flex-col items-stretch gap-1.5">
        {QUESTIONS.map((n) => {
          const q = t(`empty.${set}.${n}`);
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
