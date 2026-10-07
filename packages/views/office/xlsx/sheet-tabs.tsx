"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Copy, Ellipsis, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import type { XlsxSheetTabAction } from "./sheet-commands";

/** One tab as the strip renders it: the live sheet name, visibility and the
 *  file's tab colour (read-only — the vendored gateway has no tabColor write
 *  path, so no control offers to change it). */
export interface XlsxSheetTab {
  readonly name: string;
  readonly hidden: boolean;
  readonly tabColor: string | null;
}

export interface XlsxSheetTabsProps {
  tabs: readonly XlsxSheetTab[];
  activeSheet: string | null;
  /** False on read-only mounts and snapshot-table fallbacks. */
  canEdit: boolean;
  onSelect: (sheet: string) => void;
  onAction: (action: XlsxSheetTabAction) => void;
}

/** The upstream validateSheetName shape (1-31 chars, no \ / ? * [ ] :, no
 *  leading/trailing apostrophe). */
export function validSheetName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 31) return false;
  if (/[\\/?*[\]:]/.test(trimmed)) return false;
  return !trimmed.startsWith("'") && !trimmed.endsWith("'");
}

/** Excel-style unique default name: "Sheet", "Sheet 2", … */
export function uniqueSheetName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * The sheet-tab strip: switch tabs and run the sheet operations (add, rename,
 * delete with a confirm step, duplicate, move, hide/unhide). Every control is
 * `aria-disabled` — never hidden — without an editable selection; hidden
 * sheets are listed with an unhide control, mirroring Excel's tab strip.
 */
export function XlsxSheetTabs({ tabs, activeSheet, canEdit, onSelect, onAction }: XlsxSheetTabsProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);

  const visible = tabs.filter((tab) => !tab.hidden);
  const hiddenTabs = tabs.filter((tab) => tab.hidden);
  const activeIndex = visible.findIndex((tab) => tab.name === activeSheet);
  const active = activeIndex >= 0 ? visible[activeIndex] : undefined;
  const blocked = !canEdit || active === undefined;
  const canRemove = !blocked && visible.length > 1;
  const canMoveLeft = !blocked && activeIndex > 0;
  const canMoveRight = !blocked && activeIndex < visible.length - 1;
  const canHide = !blocked && visible.length > 1;
  // F2: reject a name already taken by another live sheet (case-insensitive,
  // matching the engine's assertSheetNameFree); a case-only rewrite of the
  // active sheet itself stays legal.
  const renameValid = validSheetName(draft) && draft.trim() !== active?.name &&
    !tabs.some((tab) => tab.name !== active?.name && tab.name.toLowerCase() === draft.trim().toLowerCase());
  // F6: the wire's reorder index is the ABSOLUTE tab position, but the strip
  // navigates the visible tabs. Map the neighbouring visible tab back to its
  // position in the full list so a hidden sheet between two visible ones does
  // not turn the move into a silent no-op (or a jump past the hidden sheet).
  const moveDestination = (delta: number): number | undefined => {
    const neighbour = visible[activeIndex + delta];
    return neighbour === undefined ? undefined : tabs.findIndex((tab) => tab.name === neighbour.name);
  };

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);
  useEffect(() => {
    setRenaming(false);
    setConfirming(false);
  }, [activeSheet]);

  const startRename = () => {
    if (blocked || !active) return;
    setDraft(active.name);
    setRenaming(true);
  };
  const duplicateActive = () => {
    if (blocked || !active) return;
    onAction({ kind: "duplicate", sheet: active.name, name: uniqueSheetName(`${active.name} ${t("office.xlsx.sheets.copySuffix")}`, tabs.map((tab) => tab.name)) });
  };
  const moveActive = (delta: number) => {
    const index = moveDestination(delta);
    if (index !== undefined && active) onAction({ kind: "move", sheet: active.name, index });
  };
  const hideActive = () => { if (canHide && active) onAction({ kind: "set-hidden", sheet: active.name, hidden: true }); };
  const removeActive = () => {
    if (!canRemove || !active) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onAction({ kind: "remove", sheet: active.name });
  };

  const commitRename = () => {
    // An invalid name keeps the input open so the user can fix it (Escape and
    // blur abandon the edit).
    if (!renameValid) return;
    if (active === undefined) {
      setRenaming(false);
      return;
    }
    const newName = draft.trim();
    setRenaming(false);
    onAction({ kind: "rename", sheet: active.name, newName });
  };

  return (
    <div className="flex h-8 w-full min-w-0 items-stretch gap-1 overflow-hidden border-t border-border bg-office-band px-2 pointer-coarse:h-11" data-testid="xlsx-sheet-tabs">
      {/* F10: the tablist is the ONLY horizontal scroller in the strip (no
          stacked scrollbars); tabs never wrap and never overlap the actions. */}
      <div role="tablist" aria-label={t("office.xlsx.sheets.label")} className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visible.map((tab) => (
          <button
            key={tab.name}
            type="button"
            role="tab"
            aria-selected={tab.name === activeSheet}
            className="flex max-w-48 shrink-0 items-center gap-1.5 border-t-2 border-transparent px-3 text-label whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground aria-selected:border-primary aria-selected:bg-background aria-selected:font-medium aria-selected:text-foreground pointer-coarse:min-w-11"
            title={tab.tabColor ? `${tab.name} - ${t("office.xlsx.sheets.tabColorReadOnly")}` : tab.name}
            onClick={() => onSelect(tab.name)}
            data-testid={`xlsx-sheet-tab-${tab.name}`}
          >
            {tab.tabColor ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: tab.tabColor }}
                data-testid={`xlsx-sheet-color-${tab.name}`}
              />
            ) : null}
            <span className="min-w-0 truncate">{tab.name}</span>
          </button>
        ))}
        {visible.length === 0 ? <span className="px-2 text-caption text-muted-foreground">{t("office.xlsx.surface.ready")}</span> : null}
      </div>
      {hiddenTabs.length > 0 ? (
        <div className="flex max-w-[40%] shrink-0 items-center gap-1 overflow-hidden" role="group" aria-label={t("office.xlsx.sheets.hiddenGroup")}>
          {hiddenTabs.map((tab) => (
            <span
              key={tab.name}
              className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2 text-label text-muted-foreground"
              data-testid={`xlsx-sheet-hidden-${tab.name}`}
            >
              <EyeOff aria-hidden className="size-3" />
              {tab.name}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`${t("office.xlsx.sheets.unhide")}: ${tab.name}`}
                title={`${t("office.xlsx.sheets.unhide")}: ${tab.name}`}
                aria-disabled={blocked || undefined}
                onClick={() => { if (!blocked) onAction({ kind: "set-hidden", sheet: tab.name, hidden: false }); }}
              >
                <Eye aria-hidden />
              </Button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="ms-auto flex shrink-0 items-center gap-0.5 self-center" role="group" aria-label={t("office.xlsx.sheets.actions")}>
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label={t("office.xlsx.sheets.add")}
          title={t("office.xlsx.sheets.add")}
          aria-disabled={!canEdit || undefined}
          onClick={() => { if (canEdit) onAction({ kind: "add", name: uniqueSheetName(t("office.xlsx.sheets.defaultName"), tabs.map((tab) => tab.name)) }); }}
          data-testid="xlsx-sheet-add"
        >
          <Plus aria-hidden />
        </Button>
        {renaming && active !== undefined ? (
          <input
            ref={renameRef}
            value={draft}
            aria-label={t("office.xlsx.sheets.renameInput")}
            aria-invalid={!validSheetName(draft) || undefined}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => setRenaming(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setRenaming(false);
              }
            }}
            className="h-6 w-32 rounded border border-input bg-background px-2 text-label pointer-coarse:min-h-9"
            data-testid="xlsx-sheet-rename-input"
          />
        ) : (
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            aria-label={t("office.xlsx.sheets.rename")}
            title={t("office.xlsx.sheets.rename")}
            aria-disabled={blocked || undefined}
            onClick={startRename}
            data-testid="xlsx-sheet-rename"
          className="max-sm:hidden"
          >
            <Pencil aria-hidden />
          </Button>
        )}
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label={t("office.xlsx.sheets.duplicate")}
          title={t("office.xlsx.sheets.duplicate")}
          aria-disabled={blocked || undefined}
          onClick={duplicateActive}
          data-testid="xlsx-sheet-duplicate"
          className="max-sm:hidden"
        >
          <Copy aria-hidden />
        </Button>
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label={t("office.xlsx.sheets.moveLeft")}
          title={t("office.xlsx.sheets.moveLeft")}
          aria-disabled={!canMoveLeft || undefined}
          onClick={() => moveActive(-1)}
          data-testid="xlsx-sheet-move-left"
          className="max-sm:hidden"
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label={t("office.xlsx.sheets.moveRight")}
          title={t("office.xlsx.sheets.moveRight")}
          aria-disabled={!canMoveRight || undefined}
          onClick={() => moveActive(1)}
          data-testid="xlsx-sheet-move-right"
          className="max-sm:hidden"
        >
          <ChevronRight aria-hidden />
        </Button>
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label={t("office.xlsx.sheets.hide")}
          title={t("office.xlsx.sheets.hide")}
          aria-disabled={!canHide || undefined}
          onClick={hideActive}
          data-testid="xlsx-sheet-hide"
          className="max-sm:hidden"
        >
          <EyeOff aria-hidden />
        </Button>
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label={confirming ? t("office.xlsx.sheets.confirmRemove") : t("office.xlsx.sheets.remove")}
          title={confirming ? t("office.xlsx.sheets.confirmRemove") : t("office.xlsx.sheets.remove")}
          aria-disabled={!canRemove || undefined}
          data-confirming={confirming || undefined}
          onClick={removeActive}
          onBlur={() => setConfirming(false)}
          data-testid="xlsx-sheet-remove"
          className={cn("max-sm:hidden", confirming && "text-destructive")}
        >
          <Trash2 aria-hidden />
        </Button>
        <DropdownMenu onOpenChange={(open) => { if (!open) setConfirming(false); }}>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="toolbar"
                size="icon-sm"
                aria-label={t("office.xlsx.sheets.actions")}
                title={t("office.xlsx.sheets.actions")}
                className="sm:hidden"
                data-testid="xlsx-sheet-actions-menu"
              >
                <Ellipsis aria-hidden />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem disabled={blocked} onClick={startRename}><Pencil aria-hidden />{t("office.xlsx.sheets.rename")}</DropdownMenuItem>
            <DropdownMenuItem disabled={blocked} onClick={duplicateActive}><Copy aria-hidden />{t("office.xlsx.sheets.duplicate")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveLeft} onClick={() => moveActive(-1)}><ChevronLeft aria-hidden />{t("office.xlsx.sheets.moveLeft")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveRight} onClick={() => moveActive(1)}><ChevronRight aria-hidden />{t("office.xlsx.sheets.moveRight")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!canHide} onClick={hideActive}><EyeOff aria-hidden />{t("office.xlsx.sheets.hide")}</DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={!canRemove}
              closeOnClick={confirming}
              data-confirming={confirming || undefined}
              onClick={removeActive}
            >
              <Trash2 aria-hidden />{confirming ? t("office.xlsx.sheets.confirmRemove") : t("office.xlsx.sheets.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
