"use client";

// B7 (UNI-924): the Insert/Update table-of-contents dialog. Depth, page-number
// column and hyperlink switches; the preview count comes from the live
// document through the command runtime, so the dialog never touches the
// editor. Page numbers are a placeholder column: the field's begin is dirty
// and Word fills the real numbers when it updates the field.
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
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { DOCX_TOC_MAX_UI_LEVEL, type DocxTocFieldOptions } from "./toc-model";

export interface DocxTocDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "insert" | "update";
  /** How many headings the live document has up to a depth (1-3). */
  headingCount: (maxLevel: number) => number;
  onApply: (options: DocxTocFieldOptions) => void;
}

export function DocxTocDialog({ open, onOpenChange, mode, headingCount, onApply }: DocxTocDialogProps) {
  const { t } = useTranslation();
  const [depth, setDepth] = useState(String(DOCX_TOC_MAX_UI_LEVEL));
  const [pageNumbers, setPageNumbers] = useState(true);
  const [hyperlinks, setHyperlinks] = useState(true);
  const maxLevel = Number(depth);
  const count = headingCount(maxLevel);
  const empty = count === 0;
  const applyLabel = mode === "insert" ? t("office.docx.toc.insert") : t("office.docx.toc.apply");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="docx-toc-dialog" className="gap-4" closeLabel={t("office.docx.toc.close")}>
        <DialogHeader className="gap-1">
          <DialogTitle>{t(mode === "insert" ? "office.docx.toc.title" : "office.docx.toc.updateTitle")}</DialogTitle>
          <DialogDescription>{t("office.docx.toc.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1">
            <Label htmlFor="docx-toc-depth" className="text-caption text-muted-foreground">
              {t("office.docx.toc.levels")}
            </Label>
            <Select
              id="docx-toc-depth"
              value={depth}
              onValueChange={(value) => setDepth(value ?? String(DOCX_TOC_MAX_UI_LEVEL))}
              items={Array.from({ length: DOCX_TOC_MAX_UI_LEVEL }, (_, index) => {
                const level = index + 1;
                return {
                  value: String(level),
                  label: level === 1 ? t("office.docx.toc.depthOne") : t("office.docx.toc.depthRange", { max: level }),
                };
              })}
            />
          </div>

          <div className="grid gap-2">
            <label className="flex items-center justify-between gap-3" htmlFor="docx-toc-page-numbers">
              <span className="text-body">{t("office.docx.toc.pageNumbers")}</span>
              <Switch id="docx-toc-page-numbers" checked={pageNumbers} onCheckedChange={setPageNumbers} />
            </label>
            <p className="text-caption text-muted-foreground">{t("office.docx.toc.pageNumbersHint")}</p>
            <label className="flex items-center justify-between gap-3" htmlFor="docx-toc-hyperlinks">
              <span className="text-body">{t("office.docx.toc.hyperlinks")}</span>
              <Switch id="docx-toc-hyperlinks" checked={hyperlinks} onCheckedChange={setHyperlinks} />
            </label>
          </div>

          <p role="status" data-testid="docx-toc-preview" className="text-body text-muted-foreground">
            {empty ? t("office.docx.toc.empty") : t("office.docx.toc.preview", { count })}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="docx-toc-cancel">
            {t("office.docx.toc.cancel")}
          </Button>
          <Button
            type="button"
            disabled={empty}
            onClick={() => onApply({ maxLevel, pageNumbers, hyperlinks })}
            data-testid="docx-toc-apply"
          >
            {applyLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
