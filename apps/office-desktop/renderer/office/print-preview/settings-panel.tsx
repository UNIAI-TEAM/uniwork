import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Select } from "@uniwork/ui/components/ui/select";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import type { DesktopPrinter } from "../../../shared/ipc";
import { PAPER_IDS, SAVE_PDF_DESTINATION, parseCopies, type Destination, type DuplexChoice, type PaperId, type PrintForm, type RangeMode, type RangeResolution } from "./print-settings";
import type { PrintersState } from "./use-print-data";

/** One radio with its visible text; Base UI names the radio from the wrapping label. */
function Choice({ value, label, disabled }: { value: string; label: string; disabled?: boolean }) {
  return <Label className="gap-2 font-normal">
    <RadioGroupItem value={value} disabled={disabled} />
    {label}
  </Label>;
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return <p id={id} className="text-caption text-destructive">{children}</p>;
}

/** A visible heading that also names the radio group below it. */
function Group({ legend, children }: { legend: string; children(labelId: string): ReactNode }) {
  const labelId = useId();
  return <div className="flex flex-col gap-1.5"><span id={labelId} className="text-body font-medium">{legend}</span>{children(labelId)}</div>;
}

function printerLabel(printer: DesktopPrinter, defaultLabel: (name: string) => string): string {
  const name = printer.displayName || printer.name;
  return printer.isDefault ? defaultLabel(name) : name;
}

/** The left half of the dialog: every setting the user can change. It owns no
 * state; `onChange` patches the dialog's form. "Save as PDF" is always the
 * first destination, so a missing or unreadable printer list still leaves
 * something to choose. A printer that needs the system dialog leaves every
 * setting disabled (the system dialog decides them); Save as PDF has no
 * copies, colour or duplex. */
export function SettingsPanel({ form, onChange, printers, destination, range, pageCount, rangeLocked }: {
  form: PrintForm;
  onChange(patch: Partial<PrintForm>): void;
  printers: PrintersState;
  /** Where the job will go: the pick, else the default (`resolveDestination`). */
  destination: Destination;
  range: RangeResolution;
  /** Pages of the laid-out preview; null while none is ready. */
  pageCount: number | null;
  /** The page choice is limited to "all" (no preview to count or choose pages from). */
  rangeLocked: boolean;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.print" });
  const ids = useId();
  const printerId = `${ids}-printer`;
  const copiesId = `${ids}-copies`;
  const paperId = `${ids}-paper`;
  const duplexId = `${ids}-duplex`;
  const rangeErrorId = `${ids}-range-error`;
  const copiesInvalid = parseCopies(form.copies) === null;
  // The system dialog asks for every setting itself: none of them applies here.
  const decidedBySystem = destination.kind === "system-dialog";
  const printing = destination.kind === "printer";
  const mode: RangeMode = rangeLocked || decidedBySystem ? "all" : form.rangeMode;
  const pagesDisabled = rangeLocked || decidedBySystem;

  const printerItems = printers.phase === "ready" ? printers.printers.map((printer) => ({ value: printer.name, label: printerLabel(printer, (name) => t("printerDefault", { name })) })) : [];
  const destinationItems = [{ value: SAVE_PDF_DESTINATION, label: t("savePdf") }, ...printerItems];
  const destinationValue = destination.kind === "save-pdf" ? SAVE_PDF_DESTINATION : destination.name;
  const unavailable = printers.phase === "error" || (printers.phase === "ready" && printers.printers.length === 0);
  const rangeError = range.kind === "invalid" && range.reason !== "pending" ? (range.reason === "bounds" ? t("rangeBounds", { count: pageCount ?? 0 }) : t("rangeSyntax")) : null;

  return <div role="group" aria-label={t("settings")} className="flex flex-col gap-4">
    {unavailable ? <p role="alert" className="text-body text-muted-foreground">{printers.phase === "error" ? t("printersError") : t("printersEmpty")}</p> : null}
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={printerId}>{t("printer")}</Label>
      {printers.phase === "loading"
        ? <p role="status" className="flex h-8 items-center gap-2 text-body text-muted-foreground"><Spinner />{t("printerLoading")}</p>
        : <Select items={destinationItems} value={destinationValue} onValueChange={(value) => { if (typeof value === "string") onChange({ deviceName: value }); }} id={printerId} />}
      {destination.kind === "save-pdf" ? <p className="text-caption text-muted-foreground">{t("savePdfNote")}</p> : null}
      {decidedBySystem ? <p className="text-caption text-muted-foreground">{t("systemDialogNote")}</p> : null}
    </div>

    <div className="flex flex-col gap-1.5">
      <Label htmlFor={copiesId}>{t("copies")}</Label>
      <Input id={copiesId} type="number" inputMode="numeric" min={1} max={999} step={1} value={form.copies} disabled={!printing} aria-invalid={printing && copiesInvalid ? true : undefined} aria-describedby={printing && copiesInvalid ? `${copiesId}-error` : undefined} onChange={(event) => onChange({ copies: event.target.value })} />
      {printing && copiesInvalid ? <FieldError id={`${copiesId}-error`}>{t("copiesInvalid")}</FieldError> : null}
    </div>

    <Group legend={t("range")}>{(labelId) => <>
      <RadioGroup aria-labelledby={labelId} value={mode} onValueChange={(value) => onChange({ rangeMode: value as RangeMode })}>
        <Choice value="all" label={t("rangeAll")} disabled={decidedBySystem} />
        <Choice value="current" label={t("rangeCurrent")} disabled={pagesDisabled} />
        <Choice value="custom" label={t("rangeCustom")} disabled={pagesDisabled} />
      </RadioGroup>
      {mode === "custom" ? <>
        <Input type="text" value={form.customRange} placeholder={t("rangeCustomPlaceholder")} aria-label={t("rangeCustomLabel")} aria-invalid={rangeError ? true : undefined} aria-describedby={rangeError ? rangeErrorId : undefined} onChange={(event) => onChange({ customRange: event.target.value })} />
        {rangeError ? <FieldError id={rangeErrorId}>{rangeError}</FieldError> : null}
      </> : null}
    </>}</Group>

    <Group legend={t("orientation")}>{(labelId) =>
      <RadioGroup aria-labelledby={labelId} value={form.landscape ? "landscape" : "portrait"} onValueChange={(value) => onChange({ landscape: value === "landscape" })}>
        <Choice value="portrait" label={t("portrait")} disabled={decidedBySystem} />
        <Choice value="landscape" label={t("landscape")} disabled={decidedBySystem} />
      </RadioGroup>}
    </Group>

    <div className="flex flex-col gap-1.5">
      <Label htmlFor={paperId}>{t("paper")}</Label>
      <Select items={PAPER_IDS.map((paper) => ({ value: paper, label: t(`paperSizes.${paper}`) }))} value={form.paper} disabled={decidedBySystem} onValueChange={(value) => { if (typeof value === "string") onChange({ paper: value as PaperId }); }} id={paperId} />
    </div>

    <Group legend={t("color")}>{(labelId) =>
      <RadioGroup aria-labelledby={labelId} value={form.color ? "color" : "mono"} onValueChange={(value) => onChange({ color: value === "color" })}>
        <Choice value="color" label={t("colorColor")} disabled={!printing} />
        <Choice value="mono" label={t("colorMono")} disabled={!printing} />
      </RadioGroup>}
    </Group>

    <div className="flex flex-col gap-1.5">
      <Label htmlFor={duplexId}>{t("duplex")}</Label>
      <Select
        items={[{ value: "simplex", label: t("duplexSimplex") }, { value: "longEdge", label: t("duplexLongEdge") }, { value: "shortEdge", label: t("duplexShortEdge") }]}
        value={form.duplex}
        disabled={!printing}
        onValueChange={(value) => { if (typeof value === "string") onChange({ duplex: value as DuplexChoice }); }}
        id={duplexId}
      />
    </div>
  </div>;
}
