"use client";

// B7 (UNI-924): insert a caption. Label + text become a paragraph carrying a
// SEQ field, so Word keeps numbering captions of the same label.
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
import { Select } from "@uniwork/ui/components/ui/select";

const CAPTION_LABELS = ["figure", "table", "equation"] as const;

export interface DocxCaptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (label: string, text: string) => void;
}

export function DocxCaptionDialog({ open, onOpenChange, onInsert }: DocxCaptionDialogProps) {
  const { t } = useTranslation();
  const [label, setLabel] = useState<(typeof CAPTION_LABELS)[number]>("figure");
  const [text, setText] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="docx-caption-dialog" className="gap-4" closeLabel={t("office.docx.captions.close")}>
        <DialogHeader className="gap-1">
          <DialogTitle>{t("office.docx.captions.title")}</DialogTitle>
          <DialogDescription>{t("office.docx.captions.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1">
            <Label htmlFor="docx-caption-label" className="text-caption text-muted-foreground">
              {t("office.docx.captions.label")}
            </Label>
            <Select
              id="docx-caption-label"
              value={label}
              onValueChange={(value) => setLabel((value ?? "figure") as (typeof CAPTION_LABELS)[number])}
              items={CAPTION_LABELS.map((kind) => ({
                value: kind,
                label: t(`office.docx.captions.labels.${kind}`),
              }))}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="docx-caption-text" className="text-caption text-muted-foreground">
              {t("office.docx.captions.text")}
            </Label>
            <Input
              id="docx-caption-text"
              value={text}
              placeholder={t("office.docx.captions.textPlaceholder")}
              onChange={(event) => setText(event.target.value)}
              data-testid="docx-caption-text"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="docx-caption-cancel">
            {t("office.docx.captions.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => onInsert(t(`office.docx.captions.labels.${label}`), text)}
            data-testid="docx-caption-apply"
          >
            {t("office.docx.captions.insert")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
