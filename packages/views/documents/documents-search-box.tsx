"use client";

import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import type { UseDocumentsSearchResult } from "./use-documents-search";

export interface DocumentsSearchBoxProps {
  search: UseDocumentsSearchResult;
  /** Inside a folder the board narrows the placeholder ("Tìm trong thư mục này"); the query still covers the workspace. */
  folderPlaceholder?: boolean;
}

/**
 * Search input for the Documents filter row (and the invalid-folder fallback).
 * At >= 48rem container (`@min-[48rem]`) an outer slot keeps a constant 20rem
 * (`w-80`, `shrink-0`) footprint so the left filter zone never shifts on focus,
 * while the right-aligned inner box animates from 14rem (`w-56`) at rest to
 * 20rem (`w-full`) on focus or while holding a query. Below 48rem the slot wraps
 * onto its own line (`basis-full`) and right-aligns the same fixed 14rem -> 20rem
 * box at >= 24rem (`@min-[24rem]`), falling back to full width only on narrow
 * phone containers (< 24rem). Ignores intermediate IME composition keystrokes
 * and clears on Escape or the clear button.
 */
export function DocumentsSearchBox({ search, folderPlaceholder = false }: DocumentsSearchBoxProps) {
  const { t } = useTranslation();
  const hasQuery = search.query.length > 0;
  return (
    <div
      data-slot="documents-search-slot"
      data-expanded={hasQuery ? "true" : "false"}
      className="flex min-w-0 max-w-full basis-full justify-end @min-[48rem]:ml-auto @min-[48rem]:w-80 @min-[48rem]:shrink-0 @min-[48rem]:basis-auto"
    >
      <div
        data-slot="documents-search-box"
        data-expanded={hasQuery ? "true" : "false"}
        className="relative flex w-full min-w-0 max-w-full items-center transition-[width] duration-200 ease-out motion-reduce:transition-none @min-[24rem]:w-56 @min-[24rem]:focus-within:w-80 @min-[24rem]:data-[expanded=true]:w-80 @min-[48rem]:w-56 @min-[48rem]:focus-within:w-full @min-[48rem]:data-[expanded=true]:w-full"
      >
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={search.query}
          onChange={(event) => {
            const nativeComposing =
              (event.nativeEvent as InputEvent | undefined)?.isComposing ?? false;
            search.onQueryChange(event.target.value, nativeComposing);
          }}
          onCompositionStart={search.onCompositionStart}
          onCompositionEnd={search.onCompositionEnd}
          onKeyDown={search.onKeyDown}
          placeholder={folderPlaceholder ? t("documents.home.search.placeholder_folder") : t("documents.home.search.placeholder")}
          aria-label={t("documents.home.search.label")}
          autoComplete="off"
          className={cn(
            "h-8 w-full pl-8 pointer-coarse:min-h-11 [&::-webkit-search-cancel-button]:hidden",
            hasQuery && "pr-8 pointer-coarse:pr-11",
          )}
        />
        {hasQuery ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("documents.home.search.clear")}
            onClick={search.clear}
            className="absolute inset-y-0 right-1 my-auto text-muted-foreground hover:text-foreground pointer-coarse:right-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          >
            <X aria-hidden className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
