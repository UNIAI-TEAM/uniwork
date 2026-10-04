"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";

/** The editable document information exposed by the PDF engine. */
export interface PdfDocumentMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
}

export type PdfSetMetadata = (metadata: Required<PdfDocumentMetadata>) => Promise<void> | void;

export interface PdfDocumentPropertiesDialogProps {
  open: boolean;
  metadata?: PdfDocumentMetadata | null;
  setMetadata: PdfSetMetadata;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
}

/** Controlled PDF properties form. Saving is deliberately callback-only so the
 * view never knows how the host serializes or commits the PDF. */
export function PdfDocumentPropertiesDialog({ open, metadata, setMetadata, onOpenChange, readOnly = false }: PdfDocumentPropertiesDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Required<PdfDocumentMetadata>>({ title: "", author: "", subject: "", keywords: "" });
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft({ title: metadata?.title ?? "", author: metadata?.author ?? "", subject: metadata?.subject ?? "", keywords: metadata?.keywords ?? "" });
      setFailed(false);
    }
    wasOpen.current = open;
  }, [open, metadata]);

  const update = (field: keyof Required<PdfDocumentMetadata>) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setDraft((current) => ({ ...current, [field]: event.target.value }));
  };
  const save = async () => {
    setSaving(true);
    setFailed(false);
    try {
      await setMetadata(draft);
      onOpenChange(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("office.pdf.properties.close")} data-testid="pdf-properties-dialog">
        <DialogHeader>
          <DialogTitle>{t("office.pdf.properties.title")}</DialogTitle>
          <DialogDescription>{t("office.pdf.properties.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {(["title", "author", "subject", "keywords"] as const).map((field) => {
            const label = t(`office.pdf.properties.fields.${field}`);
            const id = `pdf-property-${field}`;
            return <div className="grid gap-1.5" key={field}><Label htmlFor={id}>{label}</Label><Input id={id} value={draft[field]} onChange={update(field)} disabled={readOnly || saving} /></div>;
          })}
        </div>
        {failed ? <p role="alert" className="text-body text-destructive">{t("office.pdf.properties.saveError")}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t("office.pdf.properties.cancel")}</Button>
          <Button type="button" onClick={() => void save()} disabled={readOnly || saving}>{saving ? t("office.pdf.actions.saving") : t("office.pdf.properties.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
