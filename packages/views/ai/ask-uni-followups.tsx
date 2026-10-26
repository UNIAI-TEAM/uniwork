"use client";

import { useTranslation } from "react-i18next";

/** Read-only questions UNI suggests after its last answer (plus optional W6 "Tạo việc từ tài liệu này" seam); a click sends one at once. */
export function AskUniFollowups({
  items,
  onAsk,
  onProposeTasks,
}: {
  items: string[];
  onAsk: (q: string) => void;
  /** Seam for W6 "Tạo việc từ tài liệu này": rendered only when passed. */
  onProposeTasks?: () => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  if (items.length === 0 && !onProposeTasks) return null;
  const proposeLabel = t("actions.propose_tasks_from_drive");
  return (
    <li className="flex flex-col gap-1.5">
      <p className="text-caption text-muted-foreground">{t("followups.label")}</p>
      <div className="flex flex-col items-start gap-1.5">
        {onProposeTasks ? (
          <button
            type="button"
            aria-label={proposeLabel}
            onClick={onProposeTasks}
            className="rounded-md border border-border px-2.5 py-1.5 text-left text-body text-foreground hover:bg-surface-hover"
          >
            {proposeLabel}
          </button>
        ) : null}
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
