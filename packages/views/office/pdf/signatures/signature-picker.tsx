"use client";

import { useId, useRef, useState } from "react";
import { Check, ImagePlus, PenLine, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { pdfSignatureErrorMessage } from "./error";
import { formatSignatureByteCap, MAX_SAVED_SIGNATURE_BYTES, prepareSignatureImage, type PreparedSignatureImage } from "./image-file";
import { useDeleteSignature, useSaveSignature, useSavedSignatures } from "./hooks";
import { PdfSignatureDeleteDialog } from "./signature-delete-dialog";
import { savedSignatureThumbnail } from "./thumbnail";
import type { PdfSavedSignaturePickerProps, PdfSignatureThumbnail, SavedSignature } from "./types";

/**
 * The saved-signature picker: lists the caller's own signature images for one
 * organization, adds one from a local PNG/JPEG and deletes one with a
 * confirmation. Choosing a row hands the signature to the caller, which turns
 * it into a stamp placement — the picker itself never touches the engine.
 *
 * Every failure is a `role="alert"` sentence: a rejected file, an unreadable
 * answer from the server, or a delete the server did not confirm. The list
 * keeps its rows on failure rather than pretending the write landed.
 */
export function PdfSavedSignaturePicker({ orgId, selectedId = null, onSelect, disabled = false, className }: PdfSavedSignaturePickerProps) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  // The two mutation hooks only report `isPending` after a re-render, so two
  // clicks inside one tick would both pass the guard; the ref stops the second
  // before React catches up.
  const inFlightRef = useRef(false);
  const nameId = useId();
  const fileId = useId();
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedSignature | null>(null);

  const signatures = useSavedSignatures(orgId);
  const save = useSaveSignature(orgId);
  const remove = useDeleteSignature(orgId);
  const busy = save.isPending || remove.isPending;
  const rows = signatures.data ?? [];
  const byteCap = formatSignatureByteCap(MAX_SAVED_SIGNATURE_BYTES);

  const submit = async () => {
    if (!file || label.trim() === "" || busy || disabled || inFlightRef.current) return;
    inFlightRef.current = true;
    setFormError(null);
    let prepared: PreparedSignatureImage;
    try {
      prepared = await prepareSignatureImage(file);
    } catch (error) {
      setFormError(pdfSignatureErrorMessage(error, t));
      inFlightRef.current = false;
      return;
    }
    try {
      await save.mutateAsync({ label: label.trim(), contentType: prepared.contentType, image: prepared.image });
      setLabel("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (error) {
      setFormError(pdfSignatureErrorMessage(error, t));
    } finally {
      inFlightRef.current = false;
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || inFlightRef.current) return;
    inFlightRef.current = true;
    const target = deleteTarget;
    setRowError(null);
    try {
      await remove.mutateAsync(target.id);
    } catch {
      setRowError({ id: target.id, message: t("office.pdf.signatures.errors.delete") });
    } finally {
      inFlightRef.current = false;
      setDeleteTarget(null);
    }
  };

  return (
    <section
      className={cn("grid gap-3", className)}
      data-testid="pdf-signature-picker"
      aria-label={t("office.pdf.signatures.title")}
      aria-busy={signatures.isPending || undefined}
    >
      <h2 className="text-label font-medium">{t("office.pdf.signatures.title")}</h2>

      <div className="grid gap-2 rounded-md border border-border px-2.5 py-2" data-testid="pdf-signature-add">
        <div className="grid gap-1">
          <Label htmlFor={nameId}>{t("office.pdf.signatures.nameLabel")}</Label>
          <Input
            id={nameId}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={t("office.pdf.signatures.namePlaceholder")}
            disabled={disabled || busy}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={fileId}>{t("office.pdf.signatures.fileLabel")}</Label>
          <Input
            ref={fileRef}
            id={fileId}
            type="file"
            accept="image/png,image/jpeg"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            disabled={disabled || busy}
          />
          <p className="text-caption text-muted-foreground">{t("office.pdf.signatures.fileHint", { limit: byteCap })}</p>
        </div>
        {file ? <p className="min-w-0 truncate text-caption text-muted-foreground">{file.name}</p> : null}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void submit()}
            disabled={disabled || busy || file === null || label.trim() === ""}
          >
            {save.isPending ? <Spinner className="size-3.5" /> : <ImagePlus aria-hidden />}
            {save.isPending ? t("office.pdf.signatures.saving") : t("office.pdf.signatures.add")}
          </Button>
        </div>
        {formError ? <p role="alert" className="text-caption text-destructive">{formError}</p> : null}
      </div>

      {signatures.isPending ? (
        <div className="grid gap-2" data-testid="pdf-signature-loading">
          <Skeleton className="h-14 w-full" />
          <p className="text-caption text-muted-foreground">{t("office.pdf.signatures.loading")}</p>
        </div>
      ) : signatures.isError ? (
        <div className="grid gap-2" data-testid="pdf-signature-error">
          <p role="alert" className="text-caption text-destructive">{t("office.pdf.signatures.loadError")}</p>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => void signatures.refetch()} disabled={signatures.isFetching}>
              {t("office.pdf.signatures.retry")}
            </Button>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("office.pdf.signatures.empty")}</p>
      ) : (
        <ul className="grid gap-2" aria-label={t("office.pdf.signatures.title")}>
          {rows.map((row) => {
            const thumbnail: PdfSignatureThumbnail = savedSignatureThumbnail(row);
            const selected = selectedId === row.id;
            return (
              <li key={row.id} className="grid gap-1 rounded-md border border-border px-2.5 py-2" data-testid={`pdf-signature-${row.id}`}>
                <div className="flex min-h-11 items-center gap-2">
                  <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted/40">
                    {thumbnail.missing ? (
                      <PenLine aria-hidden className="size-4 text-muted-foreground" />
                    ) : (
                      <img src={thumbnail.dataUrl} alt="" className="size-full object-contain" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body">{row.label === "" ? t("office.pdf.signatures.untitled") : row.label}</p>
                    <p className="text-caption text-muted-foreground">{t("office.pdf.signatures.byteSize", { size: row.byte_size })}</p>
                  </div>
                  {onSelect ? (
                    <Button
                      type="button"
                      variant={selected ? "secondary" : "outline"}
                      size="sm"
                      aria-pressed={selected}
                      aria-label={t("office.pdf.signatures.selectNamed", { label: row.label })}
                      disabled={disabled || busy}
                      onClick={() => onSelect(row)}
                    >
                      {selected ? <Check aria-hidden /> : null}
                      {selected ? t("office.pdf.signatures.selected") : t("office.pdf.signatures.select")}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("office.pdf.signatures.deleteNamed", { label: row.label })}
                    disabled={disabled || busy}
                    onClick={() => setDeleteTarget(row)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                {rowError?.id === row.id ? <p role="alert" className="text-caption text-destructive">{rowError.message}</p> : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-caption text-muted-foreground">{t("office.pdf.signatures.contentNotice")}</p>
      <PdfSignatureDeleteDialog
        target={deleteTarget ? { id: deleteTarget.id, label: deleteTarget.label } : null}
        pending={remove.isPending}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
