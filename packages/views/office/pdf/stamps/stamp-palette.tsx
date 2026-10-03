"use client";

import { useId, useRef, useState } from "react";
import { ImagePlus, PenLine, Stamp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { pdfStampErrorMessage } from "./stamp-error";
import { prepareStampImage, type PreparedStampImage } from "./stamp-image";
import type { PdfStampOperationProvider, PdfStampPlacement, PdfStampRect, PdfStampSignatureSource } from "./types";

const DEFAULT_RECT: PdfStampRect = [36, 36, 156, 96];
const TURNS = [0, 90, 180, 270] as const;

export interface PdfStampPaletteProps {
  /**
   * The placement every stamp in this palette lands on: the zero-based
   * position in the current displayed page order and its user-space rect. The
   * provider resolves that position through `pageOrder`, so a host never
   * pre-maps it.
   */
  placement: PdfStampPlacement | null;
  provider?: PdfStampOperationProvider;
  /** Saved signatures the user can place as a stamp; the picker feeds this. */
  signatures?: readonly PdfStampSignatureSource[];
  /** The row currently chosen for placement; drives the pressed state. */
  selectedSignatureId?: string | null;
  onSelectSignature?: (signature: PdfStampSignatureSource) => void;
  disabled?: boolean;
  className?: string;
  onPlaced?: () => void;
}

/**
 * The stamp palette (UNI-925 B6): choose an image or a saved signature and
 * submit a placement through the typed `PdfStampOperationProvider` seam. The
 * engine operation lands later, so a host whose submitter rejects leaves the
 * palette showing a `role="alert"` sentence rather than a silent no-op.
 */
export function PdfStampPalette({
  placement,
  provider,
  signatures = [],
  selectedSignatureId = null,
  onSelectSignature,
  disabled = false,
  className,
  onPlaced,
}: PdfStampPaletteProps) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  // `pending` only lands after a re-render; the ref stops a second click inside
  // one tick from submitting twice.
  const inFlightRef = useRef(false);
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [turns, setTurns] = useState<0 | 90 | 180 | 270>(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rect: PdfStampRect = placement?.rect ?? DEFAULT_RECT;
  const canPlace = provider !== undefined && placement !== null;
  const blocked = disabled || pending || !canPlace;

  /** Owns the pending flag and the alert, so both callers share one path.
   *  Returns whether the placement was accepted, which decides whether the
   *  picked file is cleared. */
  const place = async (input: { kind: "image" | "signature"; image: string; contentType: string; signatureId?: string }): Promise<boolean> => {
    if (!provider || !placement || pending || inFlightRef.current) return false;
    inFlightRef.current = true;
    setPending(true);
    setError(null);
    try {
      await provider.placeStamp({
        kind: input.kind,
        contentType: input.contentType,
        image: input.image,
        ...(input.signatureId === undefined ? {} : { signatureId: input.signatureId }),
        placement: { pageIndex: placement.pageIndex, rect, ...(turns === 0 ? {} : { quarterTurns: turns }) },
      });
      onPlaced?.();
      return true;
    } catch (reason) {
      setError(pdfStampErrorMessage(reason, t));
      return false;
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  };

  const placeFile = async () => {
    if (!file || blocked) return;
    let prepared: PreparedStampImage;
    try {
      prepared = await prepareStampImage(file);
    } catch (reason) {
      setError(pdfStampErrorMessage(reason, t));
      return;
    }
    if (await place({ kind: "image", image: prepared.image, contentType: prepared.contentType })) {
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const placeSignature = async (signature: PdfStampSignatureSource) => {
    if (blocked || signature.image === "") return;
    onSelectSignature?.(signature);
    await place({ kind: "signature", image: signature.image, contentType: signature.contentType, signatureId: signature.id });
  };

  return (
    <section className={cn("grid gap-2", className)} data-testid="pdf-stamp-palette" aria-label={t("office.pdf.stamps.title")}>
      <h2 className="text-label font-medium">{t("office.pdf.stamps.title")}</h2>
      <div className="grid gap-1" role="group" aria-label={t("office.pdf.stamps.rotationLabel")}>
        <span className="text-caption text-muted-foreground">{t("office.pdf.stamps.rotation")}</span>
        <div className="flex flex-wrap items-center gap-1">
          {TURNS.map((value) => (
            <Button key={value} type="button" variant={turns === value ? "secondary" : "outline"} size="xs" aria-pressed={turns === value} disabled={disabled || pending} onClick={() => setTurns(value)}>
              {t("office.pdf.stamps.degrees", { degrees: value })}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-1 rounded-md border border-border px-2.5 py-2">
        <Label htmlFor={fileId}>{t("office.pdf.stamps.imageLabel")}</Label>
        <Input ref={fileRef} id={fileId} type="file" accept="image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={disabled || pending} />
        {file ? <p className="min-w-0 truncate text-caption text-muted-foreground">{file.name}</p> : null}
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void placeFile()} disabled={blocked || file === null}>
            {pending ? <Spinner className="size-3.5" /> : <ImagePlus aria-hidden />}
            {pending ? t("office.pdf.stamps.placing") : t("office.pdf.stamps.placeImage")}
          </Button>
        </div>
      </div>

      {signatures.length > 0 ? (
        <ul className="grid gap-1" aria-label={t("office.pdf.stamps.signaturesLabel")}>
          {signatures.map((signature) => {
            const selected = selectedSignatureId === signature.id;
            const empty = signature.image === "";
            return (
              <li key={signature.id} className="flex min-h-11 items-center gap-2 rounded-md border border-border px-2.5 py-2" data-testid={`pdf-stamp-signature-${signature.id}`}>
                <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted/40">
                  {empty ? <PenLine aria-hidden className="size-3.5 text-muted-foreground" /> : <img src={`data:${signature.contentType};base64,${signature.image}`} alt="" className="size-full object-contain" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-body">{signature.label}</span>
                <Button
                  type="button"
                  variant={selected ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={selected}
                  aria-label={t("office.pdf.stamps.placeSignatureNamed", { label: signature.label })}
                  disabled={blocked || empty}
                  onClick={() => void placeSignature(signature)}
                >
                  <Stamp aria-hidden />
                  {t("office.pdf.stamps.placeSignature")}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-caption text-muted-foreground">{t("office.pdf.stamps.noSignatures")}</p>}

      {!canPlace ? <p className="text-caption text-muted-foreground">{t("office.pdf.stamps.needPlacement")}</p> : null}
      {error ? <p role="alert" className="text-caption text-destructive">{error}</p> : null}
      <p className="text-caption text-muted-foreground">{t("office.pdf.stamps.contentNotice")}</p>
    </section>
  );
}
