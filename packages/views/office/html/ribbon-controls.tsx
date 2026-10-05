"use client";

/**
 * The HTML ribbon's two embedded controls (Amendment R, R8): the image-from-URL
 * popover and the table size grid. They live in their own module so the ribbon
 * assembler stays under the 500-line cap (RBF-3); the ribbon renders both and
 * re-exports `htmlImageUrlAllowed` for its callers.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2 } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";

const TABLE_MAX = 6;

/**
 * Whether an image URL may be offered to the document at all.
 *
 * The isolated preview gate keeps a URL only when it resolves through the
 * scoped asset proxy; an external `http(s)://`, protocol-relative or
 * `javascript:`/`data:` URL, or one carrying markup characters, is dropped. A
 * URL the gate would drop must not be offered, so this mirrors that rule for
 * the ribbon's image-from-URL control: only a relative or root-absolute path
 * without a scheme is accepted.
 */
export function htmlImageUrlAllowed(url: string): boolean {
  const value = url.trim();
  if (value.length === 0) return false;
  if (/[<>]/.test(value)) return false;
  if (value.startsWith("//")) return false;
  // A scheme (javascript:, data:, http:, mailto:, ...) is never an asset path.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || /\s/u.test(ch)) return false;
  }
  return true;
}

/** Image-from-URL control: one popover that refuses a URL the gate would drop. */
export function ImageUrlPopover({ disabled, onInsert }: { disabled: boolean; onInsert?: (url: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const label = t("office.html.ribbon.imageUrl");
  const allowed = htmlImageUrlAllowed(url);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-disabled={disabled || undefined} data-html-image-url />}
      >
        <Link2 aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-2" data-html-image-url-popover>
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={t("office.html.ribbon.imageUrlPlaceholder")}
          aria-label={t("office.html.ribbon.imageUrlPlaceholder")}
          data-html-image-url-input
        />
        {url.length > 0 && !allowed ? (
          <p className="text-caption text-destructive" role="alert">{t("office.html.ribbon.imageUrlRefused")}</p>
        ) : null}
        <Button
          type="button"
          size="sm"
          data-html-image-url-insert
          disabled={disabled || !allowed}
          onClick={() => {
            onInsert?.(url.trim());
            setOpen(false);
            setUrl("");
          }}
        >
          {t("office.html.ribbon.imageUrlInsert")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A grid size picker: hover a cell to pick rows x columns (word-processor
 * style).
 *
 * The grid is ONE composite widget, not 36 tab stops (RB-7). The shared ribbon
 * already keeps its body a single tab stop through `useRovingFocus`, so the
 * grid must NOT fight it for tabindex. Instead it captures the arrow keys at
 * the container: left/right move within a row, up/down between rows, and the
 * event is stopped in the CAPTURE phase so the ribbon's linear roving never
 * sees it. A keyboard user reaches every size with the arrows, in 2D.
 *
 * An arrow at a boundary clamps to the same cell; that event is NOT consumed
 * (RBF-4), so it bubbles to the ribbon's roving focus and the keyboard user can
 * arrow OUT of the grid to the next command.
 */
export function TableSizePicker({ disabled, onPick, label }: { disabled: boolean; onPick: (rows: number, columns: number) => void; label: string }) {
  const { t } = useTranslation();
  const [size, setSize] = useState<{ rows: number; columns: number }>({ rows: 0, columns: 0 });
  const gridRef = useRef<HTMLDivElement | null>(null);

  // A native capture-phase listener: the shared ribbon's roving handler is a
  // bubble-phase listener on the ribbon body, so stopping the event here keeps
  // the grid's 2D movement from also walking the ribbon cell by cell.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-html-table-cell]") : null;
      const cell = target?.getAttribute("data-html-table-cell");
      if (!cell) return;
      const parts = cell.split("x").map((part) => Number(part) - 1);
      const row = parts[0];
      const column = parts[1];
      if (row === undefined || column === undefined || Number.isNaN(row) || Number.isNaN(column)) return;
      const step =
        event.key === "ArrowRight" ? [0, 1] :
        event.key === "ArrowLeft" ? [0, -1] :
        event.key === "ArrowDown" ? [1, 0] :
        event.key === "ArrowUp" ? [-1, 0] :
        null;
      if (!step) return;
      const nextRow = Math.max(0, Math.min(TABLE_MAX - 1, row + step[0]!));
      const nextColumn = Math.max(0, Math.min(TABLE_MAX - 1, column + step[1]!));
      // A boundary arrow clamps to the same cell: leave it for the ribbon's
      // roving focus so the keyboard user can leave the grid.
      if (nextRow === row && nextColumn === column) return;
      event.preventDefault();
      event.stopPropagation();
      grid.querySelector<HTMLButtonElement>(`[data-html-table-cell="${nextRow + 1}x${nextColumn + 1}"]`)?.focus();
    };
    grid.addEventListener("keydown", onKeyDown, true);
    return () => grid.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div ref={gridRef} className="flex flex-col items-center gap-1 px-1" data-html-table-picker role="group" aria-label={label}>
      {Array.from({ length: TABLE_MAX }, (_, r) => (
        <div key={r} className="flex gap-0.5">
          {Array.from({ length: TABLE_MAX }, (_, c) => {
            const active = r <= size.rows - 1 && c <= size.columns - 1;
            return (
              <button
                key={c}
                type="button"
                aria-label={t("office.html.ribbon.tableSize", { rows: r + 1, cols: c + 1 })}
                aria-disabled={disabled || undefined}
                data-html-table-cell={`${r + 1}x${c + 1}`}
                className={`size-3 rounded-[2px] border border-border ${active ? "bg-brand" : "bg-background"}`}
                onMouseEnter={() => setSize({ rows: r + 1, columns: c + 1 })}
                onFocus={() => setSize({ rows: r + 1, columns: c + 1 })}
                onClick={() => {
                  if (!disabled) onPick(r + 1, c + 1);
                }}
              />
            );
          })}
        </div>
      ))}
      <span className="text-caption text-muted-foreground" data-html-table-size-label>
        {size.rows > 0 ? t("office.html.ribbon.tableSize", { rows: size.rows, cols: size.columns }) : label}
      </span>
    </div>
  );
}
