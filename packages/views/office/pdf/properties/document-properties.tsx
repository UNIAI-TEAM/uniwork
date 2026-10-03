"use client";

import { useEffect, useState } from "react";
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

function usePdfCopy() {
  const { t, i18n } = useTranslation();
  const vi = i18n.language.startsWith("vi");
  return (key: string, english: string, vietnamese: string) => t(key, { defaultValue: vi ? vietnamese : english });
}

/** Controlled PDF properties form. Saving is deliberately callback-only so the
 * view never knows how the host serializes or commits the PDF. */
export function PdfDocumentPropertiesDialog({ open, metadata, setMetadata, onOpenChange, readOnly = false }: PdfDocumentPropertiesDialogProps) {
  const { t } = useTranslation();
  const copy = usePdfCopy();
  const [draft, setDraft] = useState<Required<PdfDocumentMetadata>>({ title: "", author: "", subject: "", keywords: "" });
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft({ title: metadata?.title ?? "", author: metadata?.author ?? "", subject: metadata?.subject ?? "", keywords: metadata?.keywords ?? "" });
    setFailed(false);
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
      <DialogContent closeLabel={copy("office.pdf.properties.close", "Close", "Đóng")} data-testid="pdf-properties-dialog">
        <DialogHeader>
          <DialogTitle>{copy("office.pdf.properties.title", "Document properties", "Thuộc tính tài liệu")}</DialogTitle>
          <DialogDescription>{copy("office.pdf.properties.description", "Edit the information embedded in this PDF.", "Chỉnh sửa thông tin được nhúng trong PDF này.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {(["title", "author", "subject", "keywords"] as const).map((field) => {
            const label = copy(`office.pdf.properties.fields.${field}`, field[0]!.toUpperCase() + field.slice(1), field === "title" ? "Tiêu đề" : field === "author" ? "Tác giả" : field === "subject" ? "Chủ đề" : "Từ khóa");
            const id = `pdf-property-${field}`;
            return <div className="grid gap-1.5" key={field}><Label htmlFor={id}>{label}</Label><Input id={id} value={draft[field]} onChange={update(field)} disabled={readOnly || saving} /></div>;
          })}
        </div>
        {failed ? <p role="alert" className="text-body text-destructive">{copy("office.pdf.properties.saveError", "The properties could not be saved. Try again.", "Không thể lưu thuộc tính. Thử lại.")}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{copy("office.pdf.properties.cancel", "Cancel", "Hủy")}</Button>
          <Button type="button" onClick={() => void save()} disabled={readOnly || saving}>{saving ? t("office.pdf.actions.saving") : copy("office.pdf.properties.save", "Save", "Lưu")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const PdfPropertiesDialog = PdfDocumentPropertiesDialog;
