"use client";
import { Check, PencilLine, Play, Square, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingFeedKind } from "@uniwork/core/meetings/feed";
import { cn } from "@uniwork/ui/lib/utils";

export type MeetingFeedFilter = MeetingFeedKind | "all";

const KINDS: readonly MeetingFeedKind[] = ["decision", "task", "question", "note", "recording"];

const MARK: Record<MeetingFeedKind, { tone: string; Icon: LucideIcon | null }> = {
  decision: { tone: "bg-success-soft text-success", Icon: Check },
  task: { tone: "bg-brand-subtle text-brand", Icon: Square },
  // An open question is a "?" glyph, not an icon.
  question: { tone: "bg-warning-soft text-warning-soft-foreground", Icon: null },
  note: { tone: "bg-surface-hover text-muted-foreground", Icon: PencilLine },
  recording: { tone: "bg-surface-hover text-muted-foreground", Icon: Play },
};

/**
 * The round mark of a feed kind: 20px on a filter chip, 26px at the head of
 * a feed row. With a `label` it is an image named by its kind; without, decoration.
 */
export function FeedKindMark({ kind, size, label }: { kind: MeetingFeedKind; size: "chip" | "row"; label?: string }) {
  const { tone, Icon } = MARK[kind];
  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none",
        size === "chip" ? "size-5 text-caption" : "size-6.5 text-label",
        tone,
      )}
    >
      {Icon ? <Icon aria-hidden className={size === "chip" ? "size-3" : "size-3.5"} /> : "?"}
    </span>
  );
}

const chipClass = (active: boolean) =>
  cn(
    "inline-flex h-7.5 shrink-0 items-center gap-1.5 rounded-full border text-caption font-medium tabular-nums transition-colors pointer-coarse:h-11",
    active ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-foreground hover:bg-surface-hover",
  );

/**
 * The UNI feed's kind filter: All, then one chip per kind that has entries,
 * each its mark and count. A kind with nothing in it has no chip unless it is the chosen one.
 */
export function FeedFilterChips({
  counts,
  value,
  onChange,
}: {
  counts: Record<MeetingFeedFilter, number>;
  value: MeetingFeedFilter;
  onChange: (value: MeetingFeedFilter) => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t("meetings.panel.filters.label")} className="flex flex-wrap gap-1.5">
      <button
        type="button"
        aria-pressed={value === "all"}
        aria-label={t("meetings.panel.kind.countLabel", { kind: t("meetings.panel.filters.all"), count: counts.all })}
        className={cn(chipClass(value === "all"), "px-3")}
        onClick={() => onChange("all")}
      >
        {t("meetings.panel.filters.all")}
        <span className="opacity-70">{counts.all}</span>
      </button>
      {/* The chosen kind keeps its chip at 0, so the pressed state never vanishes. */}
      {KINDS.filter((kind) => counts[kind] > 0 || value === kind).map((kind) => (
        <button
          key={kind}
          type="button"
          aria-pressed={value === kind}
          aria-label={t("meetings.panel.kind.countLabel", { kind: t(`meetings.panel.kind.${kind}`), count: counts[kind] })}
          className={cn(chipClass(value === kind), "pl-1.5 pr-2.5")}
          onClick={() => onChange(kind)}
        >
          <FeedKindMark kind={kind} size="chip" />
          {counts[kind]}
        </button>
      ))}
    </div>
  );
}
