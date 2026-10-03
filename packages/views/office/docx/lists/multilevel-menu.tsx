"use client";

// B5 (UNI-924): the Home tab's multilevel-list menu. Level picker, level
// stepping and restart/continue all drive commands/numbering.ts; the pending
// definitions live in that command area, so this file only maps the format
// state onto menu rows.
import { ChevronsLeft, ChevronsRight, ListRestart, ListTree, MoveRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { DOCX_LIST_MAX_LEVEL, levelPreviewText, type DocxListState } from "./list-numbering";

export interface MultilevelMenuProps {
  /** The caret's list context; null when it is not in a list item. */
  list: DocxListState | null;
  disabled?: boolean;
  onSetLevel(ilvl: number): void;
  onStepLevel(direction: 1 | -1): void;
  onRestart(): void;
  onContinue(): void;
}

/** Nine rows: the definition's own levels where it has them, plain rows above
 * (a foreign list can define fewer than Word's nine). */
function pickerRows(list: DocxListState | null): Array<{ ilvl: number; numFmt: string; lvlText: string }> {
  return Array.from({ length: DOCX_LIST_MAX_LEVEL + 1 }, (_, ilvl) => {
    const level = list?.levels.find((entry) => entry.ilvl === ilvl);
    return level ?? { ilvl, numFmt: "decimal", lvlText: "" };
  });
}

export function MultilevelMenu({ list, disabled = false, onSetLevel, onStepLevel, onRestart, onContinue }: MultilevelMenuProps) {
  const { t } = useTranslation();
  const inList = list !== null;
  const rows = pickerRows(list);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            disabled={disabled}
            aria-label={t("office.docx.lists.multilevel")}
            data-testid="docx-list-multilevel"
          />
        }
      >
        <ListTree aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {/* Base UI's GroupLabel must sit inside a Menu.Group: a bare label
            directly under the popup throws `MenuGroupContext is missing` and
            unmounts the page (visual B-1). */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("office.docx.lists.levelLabel")}</DropdownMenuLabel>
        </DropdownMenuGroup>
        {/* A level pick is single-select, so the group is a radio: Base UI
            dismisses the menu on pick and the indicator marks the active level. */}
        <DropdownMenuRadioGroup
          value={inList ? String(list.ilvl) : ""}
          onValueChange={(value) => onSetLevel(Number(value))}
        >
          {rows.map((level) => (
            <DropdownMenuRadioItem
              key={level.ilvl}
              value={String(level.ilvl)}
              disabled={!inList}
              data-testid={`docx-list-level-${level.ilvl}`}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate">{t("office.docx.lists.level", { level: String(level.ilvl + 1) })}</span>
                <span className="ms-auto shrink-0 text-muted-foreground">{levelPreviewText(level)}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!inList} onClick={() => onStepLevel(1)} data-testid="docx-list-level-increase">
          <ChevronsRight aria-hidden />
          {t("office.docx.lists.increaseLevel")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!inList} onClick={() => onStepLevel(-1)} data-testid="docx-list-level-decrease">
          <ChevronsLeft aria-hidden />
          {t("office.docx.lists.decreaseLevel")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!inList} onClick={() => onRestart()} data-testid="docx-list-restart">
          <ListRestart aria-hidden />
          {t("office.docx.lists.restartNumbering")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!inList} onClick={() => onContinue()} data-testid="docx-list-continue">
          <MoveRight aria-hidden />
          {t("office.docx.lists.continueNumbering")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
