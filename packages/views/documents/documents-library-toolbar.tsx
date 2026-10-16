"use client";

import { ArrowUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Label } from "@uniwork/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { cn } from "@uniwork/ui/lib/utils";
import { ACCESS_FILTERS, FOLDER_SORT, GROUP_BY, TYPE_CHIPS, type AccessFilter, type FolderSort, type GroupBy, type TypeChip } from "./library-rows";
import { UPDATED_FILTERS, type EditorFilter, type UpdatedFilter } from "./use-documents-library";

export interface LibraryToolbarProps {
  /**
   * Which of the boards' toolbars this is: `home` — the filter bar
   * (Main.dc: Loại / Người sửa / Cập nhật), `folder` — the open folder's
   * sort (Folder.dc), `list` — the table toolbar of the Recent / Starred /
   * Shared / Elsewhere views (type chips + access pills + Group by; the old
   * scope tabs are gone with TRASH-A3, the sidebar navigates).
   */
  variant: "home" | "folder" | "list";
  chip: TypeChip;
  onChip: (chip: TypeChip) => void;
  access: AccessFilter;
  onAccess: (access: AccessFilter) => void;
  groupBy: GroupBy;
  onGroupBy: (groupBy: GroupBy) => void;
  /** `folder` variant only. */
  sort?: FolderSort;
  onSort?: (sort: FolderSort) => void;
  /** `home` variant only: the "Người sửa" filter and the workspace members behind it. */
  editor?: EditorFilter;
  onEditor?: (editor: EditorFilter) => void;
  members?: { user_id: string; display_name: string }[];
  /** `home` variant only: the "Cập nhật" filter. */
  updated?: UpdatedFilter;
  onUpdated?: (updated: UpdatedFilter) => void;
}

const FILTER_SELECT =
  "h-8 gap-1.5 rounded-md border border-border bg-background px-3 text-caption text-foreground pointer-coarse:h-11";

/** The toolbar row above the library; the variant decides which controls it shows. */
export function LibraryToolbar({
  variant,
  chip,
  onChip,
  access,
  onAccess,
  groupBy,
  onGroupBy,
  sort,
  onSort,
  editor = "any",
  onEditor,
  members,
  updated = "any",
  onUpdated,
}: LibraryToolbarProps) {
  const { t } = useTranslation();
  const groupItems = GROUP_BY.map((value) => ({ value, label: t(`documents.home.group_by.${value}`) }));
  const sortItems = FOLDER_SORT.map((value) => ({ value, label: t(`documents.home.sort.${value}`) }));

  if (variant === "folder") {
    return (
      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Label htmlFor="documents-folder-sort" className="text-caption text-muted-foreground">
          {t("documents.home.sort.label")}
        </Label>
        <Select
          value={sort}
          onValueChange={(next) => {
            if (next && next !== sort) onSort?.(next as FolderSort);
          }}
          items={sortItems}
        >
          <SelectTrigger id="documents-folder-sort" size="sm" variant="subtle" className="w-fit min-w-44">
            <ArrowUpDown aria-hidden className="size-3.5 text-muted-foreground" />
            <SelectValue>{sortItems.find((item) => item.value === sort)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sortItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (variant === "home") {
    const typeItems = TYPE_CHIPS.map((value) => ({ value, label: t(`documents.home.chips.${value}`) }));
    const editorItems = [
      { value: "any", label: t("documents.home.filters.editor_any") },
      { value: "me", label: t("documents.home.filters.editor_me") },
      ...(members ?? []).map((member) => ({ value: member.user_id, label: member.display_name })),
    ];
    const updatedItems = UPDATED_FILTERS.map((value) => ({ value, label: t(`documents.home.filters.updated_${value}`) }));
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <FilterSelect
          label={t("documents.home.filters.type")}
          value={chip}
          items={typeItems}
          onPick={(next) => onChip(next as TypeChip)}
        />
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
        {/* Pending: the boards also sketch a sort control and a list/grid
            toggle at the home root; both are unspecified for a merged,
            paged list, so neither renders until the design names them. */}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label={t("documents.home.chips_label")} className="no-scrollbar -mx-1 flex max-w-full gap-1.5 overflow-x-auto overflow-y-hidden px-1 py-1">
        {TYPE_CHIPS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={chip === value}
            onClick={() => onChip(value)}
            className={cn(
              "h-7 shrink-0 rounded-full border px-3 text-caption transition-colors pointer-coarse:h-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
              chip === value
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-foreground hover:bg-accent",
            )}
          >
            {t(`documents.home.chips.${value}`)}
          </button>
        ))}
      </div>
      {/* The caption keeps the second "All" from reading as a repeat of the type chips, wherever the groups wrap. */}
      <div className="flex max-w-full items-center gap-1.5">
        <span className="shrink-0 text-caption text-muted-foreground">{t("documents.home.access_group_caption")}</span>
        <div role="group" aria-label={t("documents.home.access_filter_label")} className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 py-0.5">
          {ACCESS_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={access === value}
              onClick={() => onAccess(value)}
              className={cn(
                "h-7 shrink-0 rounded-full border px-3 text-caption transition-colors pointer-coarse:h-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
                access === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground hover:bg-accent",
              )}
            >
              {t(`documents.home.access_filters.${value}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Label htmlFor="documents-group-by" className="text-caption text-muted-foreground">
          {t("documents.home.group_by.label")}
        </Label>
        <Select
          value={groupBy}
          onValueChange={(next) => {
            if (next && next !== groupBy) onGroupBy(next as GroupBy);
          }}
          items={groupItems}
        >
          <SelectTrigger id="documents-group-by" size="sm" variant="subtle" className="w-36">
            <SelectValue>{groupItems.find((item) => item.value === groupBy)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {groupItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

interface FilterSelectProps {
  /** The visible prefix ("Loại: …"), also the control's accessible name. */
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onPick: (value: string) => void;
}

/** One labelled dropdown of the home filter bar, "Loại: Tất cả" style. */
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
