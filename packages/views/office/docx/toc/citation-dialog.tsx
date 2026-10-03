"use client";

// B7 (UNI-924): basic citation insert. The engine cannot author a bibliography
// part (word/sources.xml) and a CITATION field without one resolves to an
// error in Word, so the honest minimal form is the bracketed reference text a
// reader sees. The dialog says so instead of writing an unresolvable field.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { docxCitationText } from "./toc-model";

export interface DocxCitationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (author: string, year: string) => void;
}

export function DocxCitationDialog({ open, onOpenChange, onInsert }: DocxCitationDialogProps) {
  const { t } = useTranslation();
  const [author, setAuthor] = useState("");
  const [year, setYear] = useState("");
  const preview = docxCitationText(author, year);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="docx-citation-dialog" className="gap-4" closeLabel={t("office.docx.captions.close")}>
        <DialogHeader className="gap-1">
          <DialogTitle>{t("office.docx.captions.citationTitle")}</DialogTitle>
          <DialogDescription>{t("office.docx.captions.citationDescription")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="docx-citation-author" className="text-caption text-muted-foreground">
              {t("office.docx.captions.author")}
            </Label>
            <Input
              id="docx-citation-author"
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              data-testid="docx-citation-author"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="docx-citation-year" className="text-caption text-muted-foreground">
              {t("office.docx.captions.year")}
            </Label>
            <Input
              id="docx-citation-year"
              value={year}
              onChange={(event) => setYear(event.target.value)}
              data-testid="docx-citation-year"
            />
          </div>
        </div>

        <p role="status" data-testid="docx-citation-preview" className="text-body text-muted-foreground">
          {preview ?? t("office.docx.captions.citationEmpty")}
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="docx-citation-cancel">
            {t("office.docx.captions.cancel")}
          </Button>
          <Button
            type="button"
            disabled={preview === null}
            onClick={() => onInsert(author, year)}
            data-testid="docx-citation-apply"
          >
            {t("office.docx.captions.insert")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
