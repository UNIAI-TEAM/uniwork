"use client";

import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import type { UseDocumentsSearchResult } from "./use-documents-search";

export interface DocumentsSearchBoxProps {
  search: UseDocumentsSearchResult;
  className?: string;
  /** Inside a folder the board narrows the placeholder ("Tìm trong thư mục này"); the query still covers the workspace. */
  folderPlaceholder?: boolean;
}

/**
 * Search input for the Documents page header (and its narrow-width row below
 * the header). Ignores intermediate IME composition keystrokes and clears on
 * Escape or the clear button.
 */
export function DocumentsSearchBox({ search, className, folderPlaceholder = false }: DocumentsSearchBoxProps) {
  const { t } = useTranslation();
  return (
    <div className={cn("relative flex min-w-0 items-center", className)}>
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
          search.query.length > 0 && "pr-8 pointer-coarse:pr-11",
        )}
      />
      {search.query.length > 0 ? (
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
  );
}
