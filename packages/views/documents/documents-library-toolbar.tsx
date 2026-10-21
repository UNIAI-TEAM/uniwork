"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { cn } from "@uniwork/ui/lib/utils";
import { DocumentTypeIcon } from "./document-type-icon";
import { ACTIVITY_FILTERS, UPDATED_FILTERS, type ActivityFilter, type EditorFilter, type UpdatedFilter } from "./doclist/filters";
import { TYPE_CHIPS, type TypeChip } from "./library-rows";

export interface LibraryToolbarProps {
  chip: TypeChip;
  onChip: (chip: TypeChip) => void;
  /** "Người sửa" and the workspace members behind it. */
  editor?: EditorFilter;
  onEditor?: (editor: EditorFilter) => void;
  members?: { user_id: string; display_name: string }[];
  /** "Cập nhật". */
  updated?: UpdatedFilter;
  onUpdated?: (updated: UpdatedFilter) => void;
  /** Gần đây only: the Tất cả / Đã mở / Đã sửa segment; absent, no segment. */
  activity?: ActivityFilter;
  onActivity?: (activity: ActivityFilter) => void;
  /** What a screen adds after Cập nhật (Lưu trữ's "Lưu trữ bởi" and its sort note). */
  children?: ReactNode;
  className?: string;
}

const FILTER_SELECT =
  "h-8 gap-1.5 rounded-md border border-border bg-background px-3 text-caption text-foreground pointer-coarse:h-11";

const PILL =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-caption transition-colors pointer-coarse:h-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11";
// Both boards: the pressed chip takes the primary tint, never a filled black pill.
const PILL_ON = "border-primary bg-primary/10 font-medium text-primary";
const PILL_OFF = "border-border bg-background text-foreground hover:bg-accent";

/**
 * The one filter bar of the document list screens (UNI-2045 W10), the same
 * controls in the same order everywhere but Thùng rác, which has none: the
 * type chips (Mọi loại · UniNote · .docx … .txt), then Người sửa, then Cập
 * nhật; Gần đây leads with its Tất cả / Đã mở / Đã sửa segment. There is no
 * access filter and no Group by (Q6): Gần đây, Được chia sẻ với tôi and Thùng
 * rác group by date on their own. Sorting lives in the table headers.
 */
export function LibraryToolbar({
  chip,
  onChip,
  editor = "any",
  onEditor,
  members,
  updated = "any",
  onUpdated,
  activity,
  onActivity,
  children,
  className,
}: LibraryToolbarProps) {
  const { t } = useTranslation();
  const editorItems = [
    { value: "any", label: t("documents.home.filters.editor_any") },
    { value: "me", label: t("documents.home.filters.editor_me") },
    ...(members ?? []).map((member) => ({ value: member.user_id, label: member.display_name })),
  ];
  const updatedItems = UPDATED_FILTERS.map((value) => ({ value, label: t(`documents.home.filters.updated_${value}`) }));
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {activity !== undefined ? <ActivitySegment activity={activity} onActivity={onActivity} /> : null}
      <TypeChipRow chip={chip} onChip={onChip} />
      <FilterSelect
        label={t("documents.home.filters.editor")}
        value={editor}
        items={editorItems}
        onPick={(next) => onEditor?.(next)}
      />
      <FilterSelect
        label={t("documents.home.filters.updated")}
        value={updated}
        items={updatedItems}
        onPick={(next) => onUpdated?.(next as UpdatedFilter)}
      />
      {children}
    </div>
  );
}

const SEGMENT =
  "h-7 shrink-0 rounded-md px-3 text-caption transition-colors pointer-coarse:h-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11";

/**
 * Gần đây's Tất cả / Đã mở / Đã sửa (both boards): a segmented radio group.
 * One radio sits in the tab order; the arrow keys move the choice, as a radio group does.
 */
function ActivitySegment({ activity, onActivity }: { activity: ActivityFilter; onActivity?: (activity: ActivityFilter) => void }) {
  const { t } = useTranslation();
  const pick = (value: ActivityFilter) => {
    if (value !== activity) onActivity?.(value);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = ACTIVITY_FILTERS.indexOf(activity);
    const next = ACTIVITY_FILTERS[(index + step + ACTIVITY_FILTERS.length) % ACTIVITY_FILTERS.length]!;
    pick(next);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={t("documents.home.filters.activity_label")}
      className="flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {ACTIVITY_FILTERS.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          data-value={value}
          aria-checked={activity === value}
          tabIndex={activity === value ? 0 : -1}
          onClick={() => pick(value)}
          onKeyDown={onKeyDown}
          className={cn(
            SEGMENT,
            activity === value ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(`documents.home.filters.activity_${value}`)}
        </button>
      ))}
    </div>
  );
}

interface TypeChipRowProps {
  chip: TypeChip;
  onChip: (chip: TypeChip) => void;
}

/** The Loại chips: one pressed-state button per type. */
function TypeChipRow({ chip, onChip }: TypeChipRowProps) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t("documents.home.chips_label")} className="no-scrollbar -mx-1 flex max-w-full gap-1.5 overflow-x-auto overflow-y-hidden px-1 py-1">
      {TYPE_CHIPS.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={chip === value}
          onClick={() => onChip(value)}
          className={cn(PILL, value !== "all" && "pl-1.5", chip === value ? PILL_ON : PILL_OFF)}
        >
          {value !== "all" ? <DocumentTypeIcon format={value} decorative className="size-4" /> : null}
          {t(`documents.home.chips.${value}`)}
        </button>
      ))}
    </div>
  );
}

interface FilterSelectProps {
  /** The visible prefix ("Người sửa: …"), also the control's accessible name. */
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onPick: (value: string) => void;
}

/** One labelled dropdown of the filter bar, "Người sửa: Bất kỳ" style. */
function FilterSelect({ label, value, items, onPick }: FilterSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next && next !== value) onPick(next as string);
      }}
      items={items}
    >
      <SelectTrigger size="sm" variant="subtle" aria-label={`${label}: ${items.find((item) => item.value === value)?.label ?? ""}`} className={FILTER_SELECT}>
        <SelectValue>{`${label}: ${items.find((item) => item.value === value)?.label ?? ""}`}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
