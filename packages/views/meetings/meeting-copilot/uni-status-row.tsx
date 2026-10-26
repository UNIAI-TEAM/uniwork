"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Captions, ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ScribeMark } from "@uniwork/ui/brand/scribe-mark";
import { cn } from "@uniwork/ui/lib/utils";
import { MARK_STATE, type ScribeChipState } from "../meeting-scribe-chip";
import { tablistKeyTarget } from "../tablist-keys";

export type UniView = "feed" | "transcript";

const VIEWS = [
  { id: "feed", label: "meetings.panel.views.feed", Icon: ListChecks },
  { id: "transcript", label: "meetings.panel.views.transcript", Icon: Captions },
] as const;

/**
 * The UNI tab's top row: what the scribe is doing (its mark and a word), then
 * the switch between the highlights and the transcript. Without the scribe
 * capability (`state` undefined) only the switch is left. `end` follows the
 * switch: the transcript's search toggle.
 */
export function UniStatusRow({
  state,
  hasLines,
  view,
  onViewChange,
  end,
}: {
  state?: ScribeChipState;
  /** The transcript has lines, so a scribe that is on is writing, not only listening. */
  hasLines: boolean;
  view: UniView;
  onViewChange: (view: UniView) => void;
  end?: ReactNode;
}) {
  const { t } = useTranslation();
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const status = state === "on" ? (hasLines ? "live" : "listening") : state;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = tablistKeyTarget(e.key, VIEWS.findIndex((v) => v.id === view), VIEWS.length);
    if (next === null) return;
    e.preventDefault();
    onViewChange(VIEWS[next]!.id);
    radios.current[next]?.focus();
  };

  return (
    <div className={cn("flex shrink-0 items-center gap-2 py-2.5 pl-3.5", end ? "pr-2.5" : "pr-3")}>
      {state && status ? (
        <>
          <ScribeMark size={22} state={MARK_STATE[state]} data-testid="uni-scribe-mark" />
          <span className="min-w-0 truncate text-label font-semibold text-foreground">{t(`meetings.panel.status.${status}`)}</span>
        </>
      ) : null}
      <div
        role="radiogroup"
        aria-label={t("meetings.panel.views.label")}
        className="ml-auto flex shrink-0 rounded-[10px] bg-surface-hover p-0.5"
      >
        {VIEWS.map(({ id, label, Icon }, i) => {
          const checked = view === id;
          return (
            <button
              key={id}
              ref={(el) => void (radios.current[i] = el)}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => onViewChange(id)}
              onKeyDown={onKeyDown}
              className={cn(
                "inline-flex h-7 items-center gap-1.25 rounded-lg px-2.5 text-caption font-medium transition-colors pointer-coarse:h-11",
                checked ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              {t(label)}
            </button>
          );
        })}
      </div>
      {end}
    </div>
  );
}
