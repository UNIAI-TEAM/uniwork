"use client";

// B6 (UNI-926): Insert-tab links + notes group. Both open a small editor-owned
// dialog for the active cell: the hyperlink dialog writes a link (or clears
// one), the note dialog writes the cell's note text. The commands port is the
// savability gate; the group stays in the tab order and inert without a mounted
// grid, a selection, or edit rights.

import { useState } from "react";
import { Link2, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { XLSX_HYPERLINK_COMMAND, XLSX_NOTE_COMMAND, parseA1Address } from "../links/link-commands";
import type { XlsxToolbarGroupProps } from "./types";
import { XLSX_ICON_BUTTON_CLASS, XlsxGroupBody, XlsxGroupRow, XlsxGroupRows, XlsxLargeButton, XlsxLargeLabel } from "./group-layout";

/** The active cell's anchor (the selection's start address). */
function activeCell(address: string | undefined): string | null {
  return address && parseA1Address(address) ? address : null;
}

export function XlsxLinksGroup({ readOnly = false, commands, selection, unitId, resolveSheetId }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const [linkOpen, setLinkOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [noteValue, setNoteValue] = useState("");
  const blocked = readOnly || !commands;
  const cell = activeCell(selection?.address);
  const ready = !blocked && !!cell;

  const sheetId = selection ? resolveSheetId?.(selection.sheet) : undefined;
  const scope = () => ({ ...(unitId ? { unitId } : {}), ...(sheetId ? { subUnitId: sheetId } : {}) });

  const applyLink = () => {
    if (!ready || !cell) return;
    try {
      void commands?.execute(XLSX_HYPERLINK_COMMAND, { ...scope(), address: cell, target: linkValue.trim() === "" ? null : linkValue.trim() });
    } catch {
      // The async command service surfaces its own failure; a refused command
      // must not unmount the toolbar.
    }
    setLinkOpen(false);
  };
  const applyNote = () => {
    if (!ready || !cell || !selection) return;
    const address = parseA1Address(cell);
    if (!address) return;
    try {
      void commands?.execute(XLSX_NOTE_COMMAND, {
        ...scope(),
        row: address.row,
        col: address.column,
        note: noteValue.trim() === "" ? null : { id: `${address.row}:${address.column}`, note: noteValue },
      });
    } catch {
      // See applyLink.
    }
    setNoteOpen(false);
  };

  return (
    <XlsxGroupBody>
      <XlsxLargeButton
        aria-label={t("office.xlsx.links.insert")}
        title={t("office.xlsx.links.insert")}
        aria-haspopup="dialog"
        aria-disabled={!ready || undefined}
        data-testid="xlsx-link-insert"
        onClick={() => { if (ready) setLinkOpen(true); }}
      >
        <Link2 aria-hidden />
        <XlsxLargeLabel>{t("office.xlsx.links.insert")}</XlsxLargeLabel>
      </XlsxLargeButton>
      <XlsxGroupRows>
        <XlsxGroupRow>
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            className={XLSX_ICON_BUTTON_CLASS}
            aria-label={t("office.xlsx.links.note")}
            title={t("office.xlsx.links.note")}
            aria-haspopup="dialog"
            aria-disabled={!ready || undefined}
            data-testid="xlsx-note-insert"
            onClick={() => { if (ready) setNoteOpen(true); }}
          >
            <MessageSquare aria-hidden />
          </Button>
        </XlsxGroupRow>
      </XlsxGroupRows>
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("office.xlsx.links.dialog.linkTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="xlsx-link-target">{t("office.xlsx.links.dialog.target")}</Label>
            <Input
              id="xlsx-link-target"
              value={linkValue}
              placeholder={t("office.xlsx.links.dialog.targetPlaceholder")}
              onChange={(event) => setLinkValue(event.target.value)}
            />
            <p className="text-caption text-muted-foreground">{t("office.xlsx.links.dialog.hint")}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLinkOpen(false)}>{t("office.xlsx.links.dialog.cancel")}</Button>
            <Button type="button" onClick={applyLink}>{t("office.xlsx.links.dialog.apply")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("office.xlsx.links.dialog.noteTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="xlsx-note-text">{t("office.xlsx.links.dialog.noteText")}</Label>
            <Input
              id="xlsx-note-text"
              value={noteValue}
              placeholder={t("office.xlsx.links.dialog.notePlaceholder")}
              onChange={(event) => setNoteValue(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNoteOpen(false)}>{t("office.xlsx.links.dialog.cancel")}</Button>
            <Button type="button" onClick={applyNote}>{t("office.xlsx.links.dialog.apply")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </XlsxGroupBody>
  );
}
