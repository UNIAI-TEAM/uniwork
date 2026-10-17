"use client";

import { useRef, useState } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { cn } from "@uniwork/ui/lib/utils";
import { ACCESS_FILTERS, FOLDER_SORT, GROUP_BY, TYPE_CHIPS, type AccessFilter, type FolderSort, type GroupBy, type TypeChip } from "./library-rows";

export const SCOPE_TABS = ["home", "recent", "shared", "shelved", "archived"] as const;
export type ScopeTab = (typeof SCOPE_TABS)[number];

export interface ScopeTabsBarProps {
  /** The active scope; null while a view without a tab (starred, a source) is open. */
  scope: ScopeTab | null;
  count: { value: number; more: boolean } | null;
  onScope: (scope: ScopeTab) => void;
}

/** The scope tabs (Tất cả / Gần đây / Được chia sẻ / Lưu trữ / Thùng rác) — shared by
 *  the library toolbar and the shelved toolbar, which carries no access/group controls. */
export function ScopeTabsBar({ scope, count, onScope }: ScopeTabsBarProps) {
  const { t } = useTranslation();
  return (
    // In the toolbar's wrapping row the root may shrink to the row (min-w-0) and the strip starts at its
    // left edge, so on a phone it scrolls sideways to every tab instead of clipping or hiding the first (F8).
    <Tabs value={scope ?? ""} onValueChange={(next) => onScope(next as ScopeTab)} className="min-w-0 max-w-full">
      <TabsList className="no-scrollbar max-w-full justify-start overflow-x-auto overflow-y-hidden" aria-label={t("documents.home.scope_label")}>
        {SCOPE_TABS.map((tab) => (
          <TabsTrigger key={tab} value={tab} className="pointer-coarse:min-h-11 pointer-coarse:min-w-11">
            {t(`documents.home.scope.${tab}`)}
            {scope === tab && count && count.value > 0 ? (
              <span className="font-mono text-caption tabular-nums text-muted-foreground">
                {count.value}
                {count.more ? "+" : ""}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export interface TypeChipRowProps {
  chip: TypeChip;
  onChip: (chip: TypeChip) => void;
}

/** The Loại chips the shelved toolbar reuses as-is (server-side `format` filters). */
export function TypeChipRow({ chip, onChip }: TypeChipRowProps) {
  const { t } = useTranslation();
  return (
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
  );
}

export interface LibraryToolbarProps {
  /** The active scope; null while a view without a tab (starred, a source) is open. */
  scope: ScopeTab | null;
  count: { value: number; more: boolean } | null;
  onScope: (scope: ScopeTab) => void;
  chip: TypeChip;
  onChip: (chip: TypeChip) => void;
  access: AccessFilter;
  onAccess: (access: AccessFilter) => void;
  /** The options the current scope may send: the trash (archived) accepts only
   *  `all` and `restricted` — the server 400s manage/edit there — so it shows
   *  exactly those two. Absent means every filter. */
  accessOptions?: readonly AccessFilter[];
  groupBy: GroupBy;
  onGroupBy: (groupBy: GroupBy) => void;
  /** Present when an open folder (`?folder`) is displayed; replaces Group by. */
  sort?: FolderSort | null;
  onSort?: (sort: FolderSort) => void;
}

/** Scope tabs, the type chips, the access filter and "Group by" (or folder "Sort by") above the table. */
export function LibraryToolbar({ scope, count, onScope, chip, onChip, access, onAccess, accessOptions, groupBy, onGroupBy, sort, onSort }: LibraryToolbarProps) {
  const { t } = useTranslation();
  const groupItems = GROUP_BY.map((value) => ({ value, label: t(`documents.home.group_by.${value}`) }));
  const sortItems = FOLDER_SORT.map((value) => ({ value, label: t(`documents.home.sort.${value}`) }));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ScopeTabsBar scope={scope} count={count} onScope={onScope} />
      <TypeChipRow chip={chip} onChip={onChip} />
      {/* The caption keeps the second "All" from reading as a repeat of the type chips, wherever the groups wrap. */}
      {/* ml-3 on top of the row gap: with only two options (archive) the group fits beside the chips and must still read as its own group. */}
      <div className="ml-3 flex max-w-full items-center gap-1.5">
        <span className="shrink-0 text-caption text-muted-foreground">{t("documents.home.access_group_caption")}</span>
        <div role="group" aria-label={t("documents.home.access_filter_label")} className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 py-0.5">
          {(accessOptions ?? ACCESS_FILTERS).map((value) => (
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
        {sort && onSort ? (
          <>
            <Label htmlFor="documents-folder-sort" className="text-caption text-muted-foreground">
              {t("documents.home.sort.label")}
            </Label>
            <Select
              key="folder-sort"
              value={sort}
              onValueChange={(next) => {
                if (next && next !== sort) onSort(next as FolderSort);
              }}
              items={sortItems}
            >
              <SelectTrigger id="documents-folder-sort" size="sm" variant="subtle" className="w-44">
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
          </>
        ) : (
          <>
            <Label htmlFor="documents-group-by" className="text-caption text-muted-foreground">
              {t("documents.home.group_by.label")}
            </Label>
            <Select
              key="group-by"
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
          </>
        )}
      </div>
    </div>
  );
}

export interface FolderBreadcrumbProps {
  /** Ancestors then the open folder, outermost first. */
  path: { id: string; title: string }[];
  canRename: boolean;
  renaming: boolean;
  onRoot: () => void;
  onFolder: (folderId: string) => void;
  onRename: (title: string) => void;
}

const MAX_UNCOLLAPSED_FOLDER_LEVELS = 3;
const ELLIPSIS = "…";

/** Documents › folder › subfolder; paths over 3 folder levels collapse intermediate ancestors into a "…" menu, and the open folder renames in place. */
export function FolderBreadcrumb({ path, canRename, renaming, onRoot, onFolder, onRename }: FolderBreadcrumbProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // One submit per edit: Enter removes the focused input, which fires blur, and
  // Escape must not commit the draft through that blur.
  const settled = useRef(false);
  const leaf = path.at(-1);
  if (!leaf) return null;
  const submit = () => {
    if (settled.current) return;
    settled.current = true;
    const title = draft.trim();
    setEditing(false);
    if (title && title !== leaf.title) onRename(title);
  };
  const collapsed = path.length > MAX_UNCOLLAPSED_FOLDER_LEVELS;
  const hiddenAncestors = collapsed ? path.slice(0, -2) : [];
  const visibleAncestors = collapsed ? [path.at(-2)!] : path.slice(0, -1);
  const crumb = "rounded px-1 text-body text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11";
  return (
    <nav aria-label={t("documents.home.breadcrumb_label")} className="flex min-w-0 items-center gap-1">
      <button type="button" className={cn(crumb, "shrink-0")} onClick={onRoot}>
        {t("documents.page.title")}
      </button>
      {hiddenAncestors.length > 0 ? (
        <span className="flex shrink-0 items-center gap-1">
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("documents.home.breadcrumb_more")}
              title={t("documents.home.breadcrumb_more")}
              className={crumb}
            >
              {ELLIPSIS}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {hiddenAncestors.map((node) => (
                <DropdownMenuItem
                  key={node.id}
                  className="px-2 py-2 pointer-coarse:min-h-11"
                  onClick={() => onFolder(node.id)}
                >
                  {node.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ) : null}
      {visibleAncestors.map((node) => (
        <span key={node.id} className="flex min-w-0 items-center gap-1">
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <button
            type="button"
            className={cn(crumb, "min-w-0 truncate")}
            onClick={() => onFolder(node.id)}
          >
            {node.title}
          </button>
        </span>
      ))}
      <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      {editing ? (
        <form
          className="flex min-w-0 items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            aria-label={t("documents.home.folders.rename_label")}
            value={draft}
            ref={(el) => el?.focus()}
            maxLength={255}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={submit}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                settled.current = true;
                setEditing(false);
              }
            }}
            className="h-8 w-56 max-w-full"
          />
        </form>
      ) : (
        <span className="flex min-w-0 items-center gap-1">
          <span aria-current="page" className="truncate px-1 text-body font-medium text-foreground">
            {leaf.title}
          </span>
          {canRename ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("documents.home.folders.rename")}
              title={t("documents.home.folders.rename")}
              aria-disabled={renaming || undefined}
              onClick={() => {
                if (renaming) return;
                settled.current = false;
                setDraft(leaf.title);
                setEditing(true);
              }}
            >
              <Pencil aria-hidden />
            </Button>
          ) : null}
        </span>
      )}
    </nav>
  );
}
