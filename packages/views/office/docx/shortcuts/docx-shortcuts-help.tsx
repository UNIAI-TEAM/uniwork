"use client";

import { Fragment, useMemo, useState, type KeyboardEvent } from "react";
import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatShortcut, getShortcutPlatform, type ShortcutChord } from "@uniwork/core/shortcuts";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { ShortcutKeycaps } from "../../../editor/shortcut-keycaps";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { DOCX_SHORTCUT_GROUPS, DOCX_SHORTCUTS, docxShortcutChords, type DocxShortcutCategory } from "./shortcut-map";
import { useDocxShortcuts } from "./use-docx-shortcuts";

interface DocxShortcutRow {
  id: string;
  category: DocxShortcutCategory;
  label: string;
  chords: readonly ShortcutChord[];
  /** Searchable chord text; the keycaps render per platform on their own. */
  chordText: string;
  write: boolean;
}

/**
 * The DOCX shortcuts reference: an inline `?` button (rendered in the status bar help slot) and `Mod+/` open a searchable,
 * grouped list of every entry in shortcut-map.ts, with the chord spelled for
 * the current platform. The map owns the bindings; this sheet only renders
 * them, so a new entry needs no change here.
 */
export function DocxShortcutsHelp({ readOnly = false }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const platform = getShortcutPlatform();

  // The hook reads handlers through a ref, so the fresh object each render
  // never re-attaches the listener.
  useDocxShortcuts({ help: () => setOpen(true) }, {
    target: typeof document === "undefined" ? null : document,
  });

  const rows = useMemo<readonly DocxShortcutRow[]>(
    () =>
      DOCX_SHORTCUTS.map((shortcut) => {
        const chords = docxShortcutChords(shortcut, platform);
        return {
          id: shortcut.id,
          category: shortcut.category,
          label: t(shortcut.labelKey, shortcut.labelVars),
          chords,
          chordText: chords.map((chord) => formatShortcut(chord, platform)).join(" "),
          write: shortcut.write === true,
        };
      }),
    [platform, t],
  );

  const needle = query.trim().toLocaleLowerCase();
  const visible = needle
    ? rows.filter((row) => `${row.label} ${row.chordText}`.toLocaleLowerCase().includes(needle))
    : rows;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onOpenChange(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("office.docx.shortcuts.title")}
        title={t("office.docx.shortcuts.title")}
        aria-haspopup="dialog"
        data-testid="docx-shortcuts-help-trigger"
        onClick={() => setOpen(true)}
      >
        <CircleHelp aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          data-testid="docx-shortcuts-dialog"
          className="gap-0 p-0 sm:max-w-xl"
          closeLabel={t("office.docx.shortcuts.close")}
          onKeyDown={onKeyDown}
        >
          <DialogHeader className="border-b border-border px-5 py-4 text-left">
            <DialogTitle>{t("office.docx.shortcuts.title")}</DialogTitle>
            <DialogDescription>{t("office.docx.shortcuts.description")}</DialogDescription>
          </DialogHeader>
          <div className="border-b border-border px-5 py-3">
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("office.docx.shortcuts.searchPlaceholder")}
              aria-label={t("office.docx.shortcuts.searchLabel")}
              data-testid="docx-shortcuts-search"
            />
          </div>
          {readOnly ? (
            <p
              className="border-b border-border bg-muted/40 px-5 py-2 text-caption text-muted-foreground"
              data-testid="docx-shortcuts-readonly-note"
            >
              {t("office.docx.shortcuts.readOnlyNote")}
            </p>
          ) : null}
          <div className="max-h-[60dvh] overflow-y-auto px-5 py-3" data-testid="docx-shortcuts-list">
            {DOCX_SHORTCUT_GROUPS.map((group) => {
              const items = visible.filter((row) => row.category === group.id);
              if (items.length === 0) return null;
              return (
                <section key={group.id} aria-labelledby={`docx-shortcuts-${group.id}`} className="mb-4 last:mb-0">
                  <h3 id={`docx-shortcuts-${group.id}`} className="mb-1 text-overline text-muted-foreground">
                    {t(group.labelKey)}
                  </h3>
                  <dl className="divide-y divide-border">
                    {items.map((row) => (
                      <div
                        key={row.id}
                        data-testid={`docx-shortcut-${row.id}`}
                        data-write={row.write ? "true" : undefined}
                        className="flex min-h-8 items-center justify-between gap-4 py-1.5"
                      >
                        <dt className="min-w-0 text-body text-foreground">
                          {row.label}
                          {readOnly && row.write ? (
                            <span className="ms-2 inline-block rounded-sm bg-muted px-1.5 py-0.5 align-middle text-micro text-muted-foreground">
                              {t("office.docx.shortcuts.readOnlyBadge")}
                            </span>
                          ) : null}
                        </dt>
                        <dd className="flex shrink-0 items-center gap-1">
                          {row.chords.map((chord, index) => (
                            <Fragment key={`${row.id}-${index}`}>
                              {index > 0 ? (
                                <span className="text-caption text-muted-foreground">
                                  {t("office.docx.shortcuts.or")}
                                </span>
                              ) : null}
                              <ShortcutKeycaps shortcut={chord} platform={platform} size="sm" />
                            </Fragment>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              );
            })}
            {visible.length === 0 ? (
              <p className="py-6 text-center text-body text-muted-foreground" data-testid="docx-shortcuts-empty">
                {t("office.docx.shortcuts.empty")}
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
