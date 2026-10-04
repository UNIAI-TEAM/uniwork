"use client";

import { useMemo, useState } from "react";
import { Omega } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { DOCX_SYMBOL_CATEGORIES, filterDocxSymbols, type DocxSymbolCategoryId } from "./symbol-data";

export interface SymbolPickerProps {
  disabled?: boolean;
  /** The picked glyph; the caller inserts it through commands/insert.ts. */
  onPick(char: string): void;
}

/**
 * Insert > Symbol picker: category buttons plus a name search over the whole
 * catalog. Every glyph is a real button, so it is reachable with Tab and
 * activatable with Enter/Space; the popover keeps focus inside while open.
 */
export function SymbolPicker({ disabled = false, onPick }: SymbolPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<DocxSymbolCategoryId>(DOCX_SYMBOL_CATEGORIES[0].id);

  const searching = query.trim() !== "";
  const results = useMemo(() => filterDocxSymbols(query, t), [query, t]);
  const active = DOCX_SYMBOL_CATEGORIES.find((group) => group.id === categoryId) ?? DOCX_SYMBOL_CATEGORIES[0];
  const symbols = searching ? results : active.symbols;

  const pick = (char: string): void => {
    onPick(char);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            disabled={disabled}
            aria-label={t("office.docx.toolbar.insert.symbol")}
            data-testid="docx-symbol-picker"
          />
        }
      >
        <Omega aria-hidden />
        <span className="text-label">{t("office.docx.toolbar.insert.symbol")}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-2 p-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("office.docx.symbols.searchPlaceholder")}
          aria-label={t("office.docx.symbols.searchPlaceholder")}
          data-testid="docx-symbol-search"
          className="h-8"
        />
        <div role="group" aria-label={t("office.docx.symbols.categoriesLabel")} className="flex flex-wrap gap-1">
          {DOCX_SYMBOL_CATEGORIES.map((group) => (
            <Button
              key={group.id}
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-label"
              aria-pressed={!searching && group.id === categoryId}
              onClick={() => {
                setQuery("");
                setCategoryId(group.id);
              }}
              data-testid={`docx-symbol-category-${group.id}`}
            >
              {t(group.labelKey)}
            </Button>
          ))}
        </div>
        {symbols.length === 0 ? (
          <p className="px-1 py-3 text-center text-caption text-muted-foreground">{t("office.docx.symbols.noMatches")}</p>
        ) : (
          <div
            role="group"
            aria-label={searching ? t("office.docx.symbols.searchResults") : t(active.labelKey)}
            className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto"
            data-testid="docx-symbol-grid"
          >
            {symbols.map((entry) => (
              <button
                key={`${entry.nameKey}-${entry.char}`}
                type="button"
                className="flex size-8 items-center justify-center rounded-md text-body hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                aria-label={t(entry.nameKey)}
                title={t(entry.nameKey)}
                onClick={() => pick(entry.char)}
                data-testid={`docx-symbol-${entry.nameKey.slice(entry.nameKey.lastIndexOf(".") + 1)}`}
              >
                <span aria-hidden>{entry.char}</span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
