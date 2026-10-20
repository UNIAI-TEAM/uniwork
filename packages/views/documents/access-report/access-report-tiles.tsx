"use client";

import { useTranslation } from "react-i18next";
import type { AccessReportSummaryTotals } from "@uniwork/core/types/document-access-report";
import { cn } from "@uniwork/ui/lib/utils";

type TileKey = "public_link" | "outside_workspace" | "direct_manage" | "documents";

/** The loudest risk first; the dot repeats the warning badges' tones, the words carry the meaning. */
const TILES: readonly { key: TileKey; label: string; hint: string; dot: string }[] = [
  { key: "public_link", label: "tile_public_link", hint: "tile_public_link_hint", dot: "bg-destructive" },
  { key: "outside_workspace", label: "tile_outside", hint: "tile_outside_hint", dot: "bg-warning" },
  { key: "direct_manage", label: "tile_direct_manage", hint: "tile_direct_manage_hint", dot: "bg-info" },
  { key: "documents", label: "tile_documents", hint: "tile_documents_hint", dot: "bg-muted-foreground" },
];

export interface AccessReportTilesProps {
  /** Whole-scope totals; `undefined` while they load or when they failed. */
  totals: AccessReportSummaryTotals | undefined;
  /** The summary could not be read: every tile says so instead of showing 0. */
  failed: boolean;
  /** The warning the list is narrowed to (`?flag`). */
  flag: string | undefined;
  /** A warning tile narrows the list to its flag, pressed again it clears; the documents tile clears. */
  onPick: (flag: string | undefined) => void;
}

/**
 * The four totals above the report (UNI-2039 F2). They count the whole scope —
 * the folder or the workspace — and do not move with the filters; three of
 * them are also the warning filter, as toggle buttons.
 */
export function AccessReportTiles({ totals, failed, flag, onPick }: AccessReportTilesProps) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);

  return (
    <div data-slot="access-report-tiles" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {TILES.map((tile) => {
        const pressed = tile.key === "documents" ? !flag : flag === tile.key;
        const value = totals ? `${number.format(totals.tiles[tile.key])}${totals.truncated ? "+" : ""}` : null;
        const hint =
          tile.key === "documents"
            ? totals
              ? t("documents.accessReport.tile_documents_hint", {
                  restricted: number.format(totals.tiles.restricted),
                  workspace: number.format(totals.tiles.workspace),
                })
              : null
            : t(`documents.accessReport.${tile.hint}`);
        return (
          <button
            key={tile.key}
            type="button"
            aria-pressed={pressed}
            aria-busy={!totals && !failed ? true : undefined}
            onClick={() => onPick(tile.key === "documents" || pressed ? undefined : tile.key)}
            className={cn(
              "flex min-w-0 flex-col items-start gap-1.5 rounded-lg border bg-card px-4 py-3.5 text-left transition-colors hover:bg-muted/50",
              pressed && tile.key !== "documents" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border",
            )}
          >
            <span className="flex items-center gap-2 text-caption text-muted-foreground">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", tile.dot)} />
              {t(`documents.accessReport.${tile.label}`)}
            </span>
            {failed ? (
              <span className="text-caption text-destructive">{t("documents.accessReport.tiles_error")}</span>
            ) : value === null ? (
              <span aria-hidden className="h-8 w-12 animate-pulse rounded-md bg-muted" />
            ) : (
              <span className="text-display-sm font-semibold tabular-nums">{value}</span>
            )}
            {hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
