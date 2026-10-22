"use client";

import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
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
import {
  ACTIVITY_FILTERS,
  UPDATED_FILTERS,
  type ActivityFilter,
  type EditorFilter,
  type UpdatedFilter,
} from "./doclist/filters";
import { TYPE_FILTERS, type DocumentTypeFilter } from "./library-rows";

export interface LibraryToolbarProps {
  /** "Loại": the picked types in menu order; empty = Tất cả. */
  types: DocumentTypeFilter[];
  onTypes: (types: DocumentTypeFilter[]) => void;
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

export const FILTER_SELECT =
  "h-8 gap-1.5 rounded-md border border-border bg-background px-3 text-caption text-foreground pointer-coarse:h-11";

export const PILL =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-caption transition-colors pointer-coarse:h-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11";
// The access report's pressed chip takes the primary tint, never a filled black pill.
export const PILL_ON = "border-primary bg-primary/10 font-medium text-primary";

/**
 * The one filter bar of the document list screens (UNI-2045 W10), the same
 * controls in the same order everywhere but Thùng rác, which has none: the
 * Loại select (Tất cả · UniNote · .docx … .txt), then Người sửa, then Cập
 * nhật; Gần đây leads with its Tất cả / Đã mở / Đã sửa segment. There is no
 * access filter and no Group by (Q6): Gần đây, Được chia sẻ với tôi and Thùng
 * rác group by date on their own. Sorting lives in the table headers.
 */
export function LibraryToolbar({
  types,
  onTypes,
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
  const typeTrigger = useRef<HTMLButtonElement>(null);
  const editorItems = [
    { value: "any", label: t("documents.home.filters.editor_any") },
    { value: "me", label: t("documents.home.filters.editor_me") },
    ...(members ?? []).map((member) => ({ value: member.user_id, label: member.display_name })),
  ];
  const updatedItems = UPDATED_FILTERS.map((value) => ({ value, label: t(`documents.home.filters.updated_${value}`) }));
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {activity !== undefined ? <ActivitySegment activity={activity} onActivity={onActivity} /> : null}
      <TypeFilterSelect types={types} onTypes={onTypes} triggerRef={typeTrigger} />
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
      <TypeChips types={types} onTypes={onTypes} focusTrigger={() => typeTrigger.current?.focus()} />
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

interface FilterSelectItem {
  value: string;
  label: string;
  /** Drawn before the label in the menu and, for the selected item, in the trigger. */
  icon?: ReactNode;
}

interface FilterSelectProps {
  /** The visible prefix ("Người sửa: …"), also the control's accessible name. */
  label: string;
  value: string;
  items: FilterSelectItem[];
  onPick: (value: string) => void;
}

/** One labelled dropdown of the filter bar, "Người sửa: Bất kỳ" style. */
export function FilterSelect({ label, value, items, onPick }: FilterSelectProps) {
  const selected = items.find((item) => item.value === value);
  const selectedLabel = selected?.label ?? "";
  const aligned = items.some((item) => item.icon !== undefined);
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next && next !== value) onPick(next as string);
      }}
      items={items}
    >
      <SelectTrigger size="sm" variant="subtle" aria-label={`${label}: ${selectedLabel}`} className={FILTER_SELECT}>
        <SelectValue>
          {`${label}: `}
          {selected?.icon}
          {selectedLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.icon ?? (aligned ? <span aria-hidden className="size-4 shrink-0" /> : null)}
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const TYPE_ALL = "all";
const CHIP =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted pl-2.5 pr-1 text-caption text-foreground pointer-coarse:h-11";

function useTypeLabel() {
  const { t } = useTranslation();
  return (type: DocumentTypeFilter) => t(`documents.home.chips.${type}`);
}

function typeIcon(type: DocumentTypeFilter) {
  return <DocumentTypeIcon format={type} decorative className="size-4" />;
}

/**
 * "Loại" (UNI-2113 r2): the FilterSelect look on a multiple Base UI Select.
 * Each type is a checkable item with its mark; Tất cả is checked while nothing
 * is picked and clears the picks when chosen. The trigger reads "Loại: Tất cả",
 * "Loại: [mark] .xlsx" for one pick, "Loại: 3 loại" for several.
 */
function TypeFilterSelect({
  types,
  onTypes,
  triggerRef,
}: {
  types: DocumentTypeFilter[];
  onTypes: (types: DocumentTypeFilter[]) => void;
  triggerRef: React.Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const typeLabel = useTypeLabel();
  const items = [
    { value: TYPE_ALL, label: t(`documents.home.chips.${TYPE_ALL}`) },
    ...TYPE_FILTERS.map((value) => ({ value, label: typeLabel(value) })),
  ];
  const shown: string[] = types.length > 0 ? types : [TYPE_ALL];
  const single = types.length === 1 ? types[0] : undefined;
  const text =
    types.length === 0
      ? t(`documents.home.chips.${TYPE_ALL}`)
      : single
        ? typeLabel(single)
        : t("documents.home.filters.type_count", { count: types.length });
  const label = t("documents.home.filters.type");
  return (
    <Select
      multiple
      value={shown}
      onValueChange={(next: string[]) => {
        if (next.some((value) => value === TYPE_ALL && !shown.includes(TYPE_ALL))) {
          onTypes([]);
          return;
        }
        const picked = TYPE_FILTERS.filter((value) => next.includes(value));
        if (picked.length === types.length && picked.every((value, index) => value === types[index])) return;
        onTypes(picked);
      }}
      items={items}
    >
      <SelectTrigger ref={triggerRef} size="sm" variant="subtle" aria-label={`${label}: ${text}`} className={FILTER_SELECT}>
        <SelectValue>
          {`${label}: `}
          {single ? typeIcon(single) : null}
          {text}
        </SelectValue>
      </SelectTrigger>
      {/* Below the trigger, not over it: the menu stays open while picking, and the trigger's count must stay readable. */}
      <SelectContent alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.value === TYPE_ALL ? <span aria-hidden className="size-4 shrink-0" /> : typeIcon(item.value as DocumentTypeFilter)}
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** One chip per picked type, after the other filters; the x drops that type only and focus goes back to the Loại trigger. */
function TypeChips({
  types,
  onTypes,
  focusTrigger,
}: {
  types: DocumentTypeFilter[];
  onTypes: (types: DocumentTypeFilter[]) => void;
  focusTrigger: () => void;
}) {
  const { t } = useTranslation();
  const typeLabel = useTypeLabel();
  return (
    <>
      {types.map((type) => (
        <span key={type} data-testid={`type-chip-${type}`} className={CHIP}>
          {typeIcon(type)}
          {typeLabel(type)}
          <button
            type="button"
            aria-label={t("documents.home.filters.type_remove", { type: typeLabel(type) })}
            onClick={() => {
              onTypes(types.filter((value) => value !== type));
              focusTrigger();
            }}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground pointer-coarse:size-11"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </span>
      ))}
    </>
  );
}
