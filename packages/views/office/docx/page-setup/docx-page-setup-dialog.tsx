"use client";

// B4 (UNI-924): the Layout ▸ Page setup dialog. It edits the section at the
// cursor (margins, orientation, paper, columns, start type) and hands the
// changed fields to the command runtime, which records them for the next save.
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DocxSectionProperties, DocxSectionStartType } from "@uniwork/office-engine/docx";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import {
  DOCX_COLUMN_CHOICES,
  DOCX_MARGIN_PRESETS,
  DOCX_PAPER_SIZES,
  DOCX_SECTION_START_TYPES,
  formatCm,
  marginPresetKey,
  marginsFit,
  paperSizeKey,
  propertiesFromDraft,
  twipsFromCm,
  type DocxPageSetupDraft,
  type DocxPageSetupOrientation,
  type DocxPageSetupSection,
  type DocxPageSetupState,
} from "./docx-page-setup";

export interface DocxPageSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The document's sections and the cursor's section (the dialog's seed). */
  state: DocxPageSetupState;
  /** Read-only documents keep the fields visible but block Apply. */
  readOnly?: boolean;
  /** The caller records the edit for the given section and closes the dialog. */
  onApply: (sectionIndex: number, properties: DocxSectionProperties) => void;
}

type PageSetupErrorKey = "invalidMargin" | "invalidSize" | "invalidSpacing" | "marginsTooLarge";

interface DialogDraft {
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  pageWidth: string;
  pageHeight: string;
  orientation: DocxPageSetupOrientation;
  columns: number;
  columnSpace: string;
  startType: DocxSectionStartType;
  marginPreset: string;
  paper: string;
}

/** Trimmed cm text; null when it is not a finite, non-negative number. */
function parseCm(raw: string): number | null {
  const value = Number(raw.trim().replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function toDialogDraft(section: DocxPageSetupSection): DialogDraft {
  return {
    marginTop: formatCm(section.marginTop),
    marginRight: formatCm(section.marginRight),
    marginBottom: formatCm(section.marginBottom),
    marginLeft: formatCm(section.marginLeft),
    pageWidth: formatCm(section.pageWidth),
    pageHeight: formatCm(section.pageHeight),
    orientation: section.orientation,
    columns: section.columns,
    columnSpace: formatCm(section.columnSpace),
    startType: section.startType,
    marginPreset: marginPresetKey(section) ?? "custom",
    paper: paperSizeKey(section),
  };
}

export function DocxPageSetupDialog({ open, onOpenChange, state, readOnly = false, onApply }: DocxPageSetupDialogProps) {
  const { t } = useTranslation();
  const marginTopId = useId();
  const marginRightId = useId();
  const marginBottomId = useId();
  const marginLeftId = useId();
  const paperWidthId = useId();
  const paperHeightId = useId();
  const columnSpaceId = useId();
  const errorId = useId();
  // The dialog targets the section it was opened on; a modal blocks moving the
  // caret elsewhere, and the seed must not follow live state refreshes.
  const [sectionIndex] = useState(() => Math.min(Math.max(state.activeIndex, 0), Math.max(state.sections.length - 1, 0)));
  const [section] = useState(() => state.sections[sectionIndex]!);
  const [draft, setDraft] = useState<DialogDraft>(() => toDialogDraft(section));

  const resolved = useMemo<{ draft: DocxPageSetupDraft | null; error: PageSetupErrorKey | null }>(() => {
    const marginTop = parseCm(draft.marginTop);
    const marginRight = parseCm(draft.marginRight);
    const marginBottom = parseCm(draft.marginBottom);
    const marginLeft = parseCm(draft.marginLeft);
    if (marginTop === null || marginRight === null || marginBottom === null || marginLeft === null) {
      return { draft: null, error: "invalidMargin" };
    }
    const pageWidth = parseCm(draft.pageWidth);
    const pageHeight = parseCm(draft.pageHeight);
    if (pageWidth === null || pageHeight === null || pageWidth <= 0 || pageHeight <= 0) {
      return { draft: null, error: "invalidSize" };
    }
    const columnSpace = parseCm(draft.columnSpace);
    if (columnSpace === null) return { draft: null, error: "invalidSpacing" };
    const next: DocxPageSetupDraft = {
      pageWidth: twipsFromCm(pageWidth),
      pageHeight: twipsFromCm(pageHeight),
      orientation: draft.orientation,
      marginTop: twipsFromCm(marginTop),
      marginRight: twipsFromCm(marginRight),
      marginBottom: twipsFromCm(marginBottom),
      marginLeft: twipsFromCm(marginLeft),
      columns: draft.columns,
      columnSpace: twipsFromCm(columnSpace),
      startType: draft.startType,
    };
    if (!marginsFit(next.pageWidth, next.pageHeight, next)) return { draft: null, error: "marginsTooLarge" };
    return { draft: next, error: null };
  }, [draft]);

  const setMargins = (preset: (typeof DOCX_MARGIN_PRESETS)[number] | null) => {
    if (!preset) {
      setDraft((current) => ({ ...current, marginPreset: "custom" }));
      return;
    }
    setDraft((current) => ({
      ...current,
      marginPreset: preset.key,
      marginTop: formatCm(preset.top),
      marginRight: formatCm(preset.right),
      marginBottom: formatCm(preset.bottom),
      marginLeft: formatCm(preset.left),
    }));
  };

  const setMarginValue = (side: "top" | "right" | "bottom" | "left", value: string) => {
    setDraft((current) => ({
      ...current,
      ...(side === "top"
        ? { marginTop: value }
        : side === "right"
          ? { marginRight: value }
          : side === "bottom"
            ? { marginBottom: value }
            : { marginLeft: value }),
      marginPreset: "custom",
    }));
  };

  const setOrientation = (orientation: DocxPageSetupOrientation) => {
    setDraft((current) => {
      if (current.orientation === orientation) return current;
      return { ...current, orientation, pageWidth: current.pageHeight, pageHeight: current.pageWidth };
    });
  };

  const setPaper = (key: string) => {
    const size = DOCX_PAPER_SIZES.find((entry) => entry.key === key);
    setDraft((current) => {
      if (!size) return { ...current, paper: "custom" };
      const landscape = current.orientation === "landscape";
      return {
        ...current,
        paper: key,
        pageWidth: formatCm(landscape ? size.height : size.width),
        pageHeight: formatCm(landscape ? size.width : size.height),
      };
    });
  };

  const apply = () => {
    if (readOnly || !resolved.draft) return;
    const properties = propertiesFromDraft(resolved.draft, section);
    if (Object.keys(properties).length > 0) onApply(sectionIndex, properties);
    onOpenChange(false);
  };

  const marginLabel = (side: "top" | "right" | "bottom" | "left") => t(`office.docx.pageSetup.margins.${side}`);
  const marginInput = (side: "top" | "right" | "bottom" | "left", id: string, value: string) => (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-caption text-muted-foreground">
        {marginLabel(side)}
      </Label>
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          disabled={readOnly}
          aria-invalid={resolved.error === "invalidMargin" || undefined}
          aria-describedby={resolved.error === "invalidMargin" ? errorId : undefined}
          onChange={(event) => setMarginValue(side, event.target.value)}
          data-testid={`docx-page-setup-margin-${side}`}
        />
        <span className="text-caption text-muted-foreground">{t("office.docx.pageSetup.unitCm")}</span>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="docx-page-setup-dialog" className="gap-4" closeLabel={t("common.close")}>
        <DialogHeader className="gap-1">
          <DialogTitle>{t("office.docx.pageSetup.title")}</DialogTitle>
          <DialogDescription>
            {t("office.docx.pageSetup.section", { current: sectionIndex + 1, total: state.sections.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <h3 className="text-body font-medium">{t("office.docx.pageSetup.margins.label")}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1 sm:col-span-2">
                <Label htmlFor={`${marginTopId}-preset`} className="text-caption text-muted-foreground">
                  {t("office.docx.pageSetup.margins.preset")}
                </Label>
                <Select
                  id={`${marginTopId}-preset`}
                  value={draft.marginPreset}
                  disabled={readOnly}
                  onValueChange={(value) => setMargins(DOCX_MARGIN_PRESETS.find((preset) => preset.key === value) ?? null)}
                  items={[
                    ...DOCX_MARGIN_PRESETS.map((preset) => ({ value: preset.key, label: t(`office.docx.pageSetup.margins.${preset.key}`) })),
                    { value: "custom", label: t("office.docx.pageSetup.margins.custom") },
                  ]}
                />
              </div>
              {marginInput("top", marginTopId, draft.marginTop)}
              {marginInput("bottom", marginBottomId, draft.marginBottom)}
              {marginInput("left", marginLeftId, draft.marginLeft)}
              {marginInput("right", marginRightId, draft.marginRight)}
            </div>
          </div>

          <div className="grid gap-2">
            <h3 className="text-body font-medium">{t("office.docx.pageSetup.orientation.label")}</h3>
            <div className="flex gap-2">
              {(["portrait", "landscape"] as const).map((orientation) => (
                <Button
                  key={orientation}
                  type="button"
                  variant={draft.orientation === orientation ? "default" : "outline"}
                  aria-pressed={draft.orientation === orientation}
                  disabled={readOnly}
                  onClick={() => setOrientation(orientation)}
                  data-testid={`docx-page-setup-${orientation}`}
                >
                  {t(`office.docx.pageSetup.orientation.${orientation}`)}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <h3 className="text-body font-medium">{t("office.docx.pageSetup.paper.label")}</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="grid gap-1 sm:col-span-3">
                <Label htmlFor={`${paperWidthId}-preset`} className="text-caption text-muted-foreground">
                  {t("office.docx.pageSetup.paper.preset")}
                </Label>
                <Select
                  id={`${paperWidthId}-preset`}
                  value={draft.paper}
                  disabled={readOnly}
                  onValueChange={(value) => setPaper(value ?? "custom")}
                  items={[
                    ...DOCX_PAPER_SIZES.map((size) => ({ value: size.key, label: t(`office.docx.pageSetup.paper.${size.key}`) })),
                    { value: "custom", label: t("office.docx.pageSetup.paper.custom") },
                  ]}
                />
              </div>
              <div className="grid gap-1 sm:col-span-2">
                <Label htmlFor={paperWidthId} className="text-caption text-muted-foreground">
                  {t("office.docx.pageSetup.paper.width")}
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id={paperWidthId}
                    inputMode="decimal"
                    value={draft.pageWidth}
                    disabled={readOnly}
                    aria-describedby={resolved.error === "invalidSize" ? errorId : undefined}
                    onChange={(event) => setDraft((current) => ({ ...current, pageWidth: event.target.value, paper: "custom" }))}
                    data-testid="docx-page-setup-paper-width"
                  />
                  <span className="text-caption text-muted-foreground">{t("office.docx.pageSetup.unitCm")}</span>
                </div>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={paperHeightId} className="text-caption text-muted-foreground">
                  {t("office.docx.pageSetup.paper.height")}
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id={paperHeightId}
                    inputMode="decimal"
                    value={draft.pageHeight}
                    disabled={readOnly}
                    aria-describedby={resolved.error === "invalidSize" ? errorId : undefined}
                    onChange={(event) => setDraft((current) => ({ ...current, pageHeight: event.target.value, paper: "custom" }))}
                    data-testid="docx-page-setup-paper-height"
                  />
                  <span className="text-caption text-muted-foreground">{t("office.docx.pageSetup.unitCm")}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <h3 className="text-body font-medium">{t("office.docx.pageSetup.columns.label")}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                aria-label={t("office.docx.pageSetup.columns.label")}
                value={String(draft.columns)}
                disabled={readOnly}
                onValueChange={(value) => setDraft((current) => ({ ...current, columns: Number(value) }))}
                items={DOCX_COLUMN_CHOICES.map((count) => ({
                  value: String(count),
                  label: t(`office.docx.pageSetup.columns.${count === 1 ? "one" : count === 2 ? "two" : "three"}`),
                }))}
              />
              <div className="grid gap-1">
                <Label htmlFor={columnSpaceId} className="text-caption text-muted-foreground">
                  {t("office.docx.pageSetup.columns.spacing")}
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id={columnSpaceId}
                    inputMode="decimal"
                    value={draft.columnSpace}
                    disabled={readOnly}
                    aria-invalid={resolved.error === "invalidSpacing" || undefined}
                    aria-describedby={resolved.error === "invalidSpacing" ? errorId : undefined}
                    onChange={(event) => setDraft((current) => ({ ...current, columnSpace: event.target.value }))}
                    data-testid="docx-page-setup-column-space"
                  />
                  <span className="text-caption text-muted-foreground">{t("office.docx.pageSetup.unitCm")}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-1">
            <Label htmlFor={`${marginTopId}-start`} className="text-caption text-muted-foreground">
              {t("office.docx.pageSetup.startType.label")}
            </Label>
            <Select
              id={`${marginTopId}-start`}
              value={draft.startType}
              disabled={readOnly}
              onValueChange={(value) => setDraft((current) => ({ ...current, startType: value as DocxSectionStartType }))}
              items={DOCX_SECTION_START_TYPES.map((startType) => ({
                value: startType,
                label: t(`office.docx.pageSetup.startType.${startType}`),
              }))}
            />
          </div>
        </div>

        {resolved.error ? (
          <p id={errorId} role="alert" className="text-caption text-destructive">
            {t(`office.docx.pageSetup.${resolved.error}`)}
          </p>
        ) : (
          <p className="text-caption text-muted-foreground">{t("office.docx.pageSetup.hint")}</p>
        )}

        <DialogFooter className="flex-row items-center justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={readOnly || resolved.error !== null} onClick={apply} data-testid="docx-page-setup-apply">
            {t("office.docx.pageSetup.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
