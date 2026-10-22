"use client";

import {
  CalendarClock,
  CalendarDays,
  ChartColumn,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Clock,
  FileText,
  Flag,
  Flame,
  Hourglass,
  Link,
  ListChecks,
  ListOrdered,
  ListPlus,
  MessagesSquare,
  ScrollText,
  UserPlus,
  UserRound,
  Users,
  UserX,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { AskUniProviderMark, type AskLook } from "./ask-uni-provider";
import "./ask-uni-empty.css";

const KINDS = ["task", "project", "meeting", "document", "room"];

// Spelled out so Tailwind finds each class in the source.
const TINT = {
  orange: "text-tint-orange-foreground",
  blue: "text-tint-blue-foreground",
  violet: "text-tint-violet-foreground",
  green: "text-tint-green-foreground",
  teal: "text-tint-teal-foreground",
  red: "text-tint-red-foreground",
} as const;

/** Each set's questions 1-4 (`ai.empty.<set>.<n>`), as the icon and tint that say what kind of answer they get. */
const SETS: Record<string, [LucideIcon, keyof typeof TINT][]> = {
  task: [[ScrollText, "blue"], [CircleAlert, "orange"], [UserPlus, "violet"], [Link, "teal"]],
  project: [[ChartColumn, "blue"], [Clock, "orange"], [Users, "violet"], [UserX, "teal"]],
  meeting: [[ScrollText, "blue"], [CircleCheck, "green"], [ListChecks, "violet"], [ClipboardList, "orange"]],
  document: [[FileText, "blue"], [CalendarClock, "orange"], [Link, "teal"], [UserRound, "violet"]],
  room: [[MessagesSquare, "blue"], [ListPlus, "orange"], [Hourglass, "violet"], [CircleCheck, "green"]],
  other: [[Clock, "orange"], [ListOrdered, "blue"], [Video, "violet"], [CircleCheck, "green"]],
  more: [[Users, "blue"], [Flag, "orange"], [CalendarDays, "violet"], [Flame, "red"]],
};

/**
 * The empty panel: the picked model's mark and welcome (UNI's for Auto, the provider's for a model with a look, as
 * ClickUp Brain does), then two drifting rows of read-only questions: the open page's, then general ones (more of
 * them when the page has no set of its own). A click asks at once. Its motion is the one decorative exception
 * PRODUCT.md allows, and stops entirely under reduced motion (ask-uni-empty.css).
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
  const reduce = useReducedMotion() ?? false;
  // Members and page kinds without a set (threads, messages) share the general questions.
  const set = kind && KINDS.includes(kind) ? kind : "other";
  const rows = [set, set === "other" ? "more" : "other"];
  const branded = look !== null && model !== "";
  const chips = (row: string) =>
    SETS[row]!.map(([Icon, tint], i) => {
      const q = t(`empty.${row}.${i + 1}`);
      return (
        <button
          key={q}
          type="button"
          aria-disabled={disabled || undefined}
          onClick={disabled ? undefined : () => onAsk(q)}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-[var(--ask-input)] py-1 pr-3 pl-2 text-label text-foreground transition-colors hover:border-primary hover:bg-surface-hover"
        >
          <Icon aria-hidden className={cn("size-3.5 shrink-0", TINT[tint])} />
          {q}
        </button>
      );
    });
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-4 py-6"
      data-slot="ask-uni-empty"
      data-motion={reduce ? "reduced" : "full"}
    >
      <span data-slot="ask-uni-empty-mark" className="inline-flex">
        <AskUniProviderMark look={branded ? look : null} size={branded ? 36 : 48} />
      </span>
      <div className="ask-uni-welcome flex flex-col items-center gap-1 text-center">
        <h2 className="text-title font-medium text-foreground">{t(branded ? `empty.title_${look}` : "empty.title")}</h2>
        <p className="text-body text-muted-foreground">
          {branded ? t(`models.${model}.description`, { defaultValue: "" }) : t("model.auto_description")}
        </p>
      </div>
      <div className="ask-uni-suggestions -mx-4 flex flex-col gap-1 self-stretch">
        {rows.map((row, i) => (
          <div key={row} className="ask-uni-band" data-row={i}>
            <div className="ask-uni-track">
              <div className="ask-uni-copy">{chips(row)}</div>
              {/* The second copy closes the loop; it is scenery, so no one reads or tabs into it. */}
              {reduce ? null : (
                <div className="ask-uni-copy" data-copy="echo" aria-hidden inert>
                  {chips(row)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
