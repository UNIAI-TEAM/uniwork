"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TrashKind } from "@uniwork/core/trash";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { KindFilter, PeopleFilter, TRASH_KIND_ORDER } from "./trash-filter-chips";

/** Empty means "no filter": the endpoint leaves it off the URL. */
export interface TrashFilterValues {
  q: string;
  kinds: TrashKind[];
  trashedBy: string[];
}

export const EMPTY_TRASH_FILTERS: TrashFilterValues = { q: "", kinds: [], trashedBy: [] };

/**
 * One row above the trash: name search, then the Loại and Người xóa chips.
 * Values within a chip are OR-ed; the chips and the search narrow each other.
 * Each applies as it changes.
 */
export function TrashFilters({
  filters,
  onChange,
  members,
  meId,
  documentsEnabled,
}: {
  filters: TrashFilterValues;
  onChange: (next: TrashFilterValues) => void;
  members: readonly { user_id: string; display_name: string; email?: string; avatar_url?: unknown }[];
  meId: string;
  /** Off, the kind filter has no Tài liệu: the server lists no documents then. */
  documentsEnabled: boolean;
}) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);
  const kinds = documentsEnabled ? TRASH_KIND_ORDER : TRASH_KIND_ORDER.filter((k) => k !== "document");

  return (
    <div role="search" aria-label={t("trash.filters_label")} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative sm:w-64">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          type="search"
          aria-label={t("trash.search")}
          placeholder={t("trash.search")}
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          className="pr-8 pl-8 pointer-coarse:pr-12 [&::-webkit-search-cancel-button]:hidden"
        />
        {filters.q ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("trash.clear_search")}
            className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
            onClick={() => {
              onChange({ ...filters, q: "" });
              searchRef.current?.focus();
            }}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <KindFilter kinds={filters.kinds} options={kinds} onChange={(next) => onChange({ ...filters, kinds: next })} />
        <PeopleFilter
          trashedBy={filters.trashedBy}
          members={members}
          meId={meId}
          onChange={(next) => onChange({ ...filters, trashedBy: next })}
        />
      </div>
    </div>
  );
}
