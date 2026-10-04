"use client";

// Wave A / A9 (UNI-926): the shortcuts map/help dialog. It renders the ONE
// static catalog (`catalog.ts`) grouped by area with a search filter; the keys
// are drawn with the shared `ShortcutKeycaps`, so Ctrl vs Cmd follows the same
// platform detection the rest of the product uses. Every label goes through
// `t()`; the copy lives under `office.xlsx.shortcuts.*` in both locales.

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { ShortcutKeycaps } from "../../../editor/shortcut-keycaps";
import {
  filterShortcutEntries,
  shortcutEntriesForCategory,
  XLSX_SHORTCUT_CATEGORIES,
  XLSX_SHORTCUTS,
  type XlsxShortcutEntry,
} from "./catalog";

export function XlsxShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const labelOf = useCallback((entry: XlsxShortcutEntry) => t(entry.labelKey), [t]);
  const visible = useMemo(
    () => filterShortcutEntries(XLSX_SHORTCUTS, query, labelOf),
    [labelOf, query],
  );
  const groups = XLSX_SHORTCUT_CATEGORIES
    .map((category) => ({ category, entries: shortcutEntriesForCategory(visible, category) }))
    .filter((group) => group.entries.length > 0);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-testid="xlsx-shortcuts" closeLabel={t("office.xlsx.shortcuts.close")} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("office.xlsx.shortcuts.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1">
          <Label htmlFor="xlsx-shortcuts-search" className="text-caption font-medium">
            {t("office.xlsx.shortcuts.search")}
          </Label>
          <Input
            id="xlsx-shortcuts-search"
            data-testid="xlsx-shortcuts-search"
            className="h-8"
            autoFocus
            value={query}
            placeholder={t("office.xlsx.shortcuts.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {groups.length === 0 ? (
          <p role="status" className="text-caption text-muted-foreground" data-testid="xlsx-shortcuts-empty">
            {t("office.xlsx.shortcuts.empty")}
          </p>
        ) : (
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-2">
            {groups.map(({ category, entries }) => (
              <section
                key={category}
                role="group"
                aria-labelledby={`xlsx-shortcuts-category-${category}`}
                data-testid={`xlsx-shortcuts-${category}`}
              >
                <h3 id={`xlsx-shortcuts-category-${category}`} className="pb-1 text-caption font-semibold text-muted-foreground">
                  {t(`office.xlsx.shortcuts.categories.${category}`)}
                </h3>
                <dl className="grid gap-1">
                  {entries.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2" data-testid={`xlsx-shortcut-${item.id}`}>
                      <dt className="text-caption">{t(item.labelKey)}</dt>
                      <dd className="flex items-center gap-1">
                        {item.chords.map((chord, index) => (
                          <ShortcutKeycaps key={index} shortcut={chord} size="sm" />
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}