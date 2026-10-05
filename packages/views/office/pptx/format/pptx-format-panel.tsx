"use client";

/**
 * Format tab body (A4ui, UNI-927). The self-contained panel the serialized
 * UI-wire round mounts for a selected element: Fill, Line, Effects,
 * Size/Geometry, Arrange and Text - one section per group of the committed A4e
 * `FormatEdit` union.
 *
 * Contract. The panel is driven by one optional async port and the host's
 * selection, and it owns no session, no transport and no save path:
 *
 *   onApplyEdit?(edit: FormatEdit): Promise<unknown>  // the engine edit channel
 *   onError?(error: unknown): void                    // host reporting seam
 *
 * `onApplyEdit` receives exactly the committed A4e `FormatEdit` union member, so
 * the wire round is a one-line binding (`(edit) => handle.edit([edit])` or
 * `model.applyEdit(edit)`). With no port bound, or no element selected, every
 * control is disabled and the panel says why - it never fakes a capability (the
 * lane's honesty rule).
 *
 * States: loading (a probe is in flight), empty (nothing selected), ready, busy
 * (an edit is applying), error (the last edit was refused; the message is shown
 * and the document is unchanged). The document is only ever mutated by
 * `onApplyEdit`; the six sections own their own field state and report one built
 * edit each.
 */
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { cn } from "@uniwork/ui/lib/utils";
import type { FormatEdit, PptxTextAnchor, PptxTextAutofit } from "@uniwork/office-engine/pptx";
import { formatOpAllowed } from "./format-model";
import {
  PptxFormatEffectsSection,
  PptxFormatFillSection,
  PptxFormatLineSection,
  type PptxFormatSectionProps,
} from "./format-sections";
import {
  PptxFormatArrangeSection,
  PptxFormatGeometrySection,
  PptxFormatTextSection,
} from "./format-sections-b";
import "./format-i18n";

export interface PptxFormatPanelProps {
  /** The engine edit channel (one committed `FormatEdit` per call). Absent ->
   *  every control is disabled with the "not bound" reason. */
  onApplyEdit?: (edit: FormatEdit) => Promise<unknown>;
  /** A refused edit surfaces here as well as in the panel's own alert. */
  onError?: (error: unknown) => void;
  /** 0-based slide the selection lives on; null means "no slide". */
  slideIndex?: number | null;
  /** The selected element id (the anchor of the selection); null = none. */
  selectedElementId?: string | null;
  /** Type of the selected element ('text' | 'shape' | 'picture' | 'group' | ...),
   *  used to disable a section the engine would refuse. */
  selectedElementType?: string | null;
  /** Every selected id, for the arrange ops (group / flip / align / distribute). */
  selectedIds?: readonly string[];
  /** The selected element's current fill colour, for the field seed. */
  fillColor?: string | null;
  /** The selected element's current outline width in EMU, for the field seed. */
  strokeWidthEmu?: number | null;
  /** The selected element's current text anchor, for the radio group. */
  textAnchor?: PptxTextAnchor | null;
  /** The selected element's current autofit mode. */
  autofit?: PptxTextAutofit | null;
  /** The selected element's current wrap setting. */
  wrapText?: boolean | null;
  /** A probe (capability/asset read) is in flight. */
  loading?: boolean;
  /** Explicit read-only mode (viewer permissions). */
  disabled?: boolean;
  className?: string;
}

export function PptxFormatPanel({
  onApplyEdit,
  onError,
  slideIndex = null,
  selectedElementId = null,
  selectedElementType = null,
  selectedIds = [],
  fillColor = null,
  strokeWidthEmu = null,
  textAnchor = null,
  autofit = null,
  wrapText = null,
  loading = false,
  disabled = false,
  className,
}: PptxFormatPanelProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const busyRef = useRef(false);

  const bound = typeof onApplyEdit === "function";
  const hasSelection = typeof selectedElementId === "string" && selectedElementId.length > 0;
  const blocked = disabled || !bound || !hasSelection || busy;
  const elementId = hasSelection ? (selectedElementId as string) : "";
  const slide = slideIndex === null ? 0 : slideIndex;
  const ids = selectedIds.length > 0 ? selectedIds : hasSelection ? [elementId] : [];

  const run = useCallback(
    (build: () => FormatEdit): void => {
      if (!onApplyEdit || busyRef.current) return;
      let edit: FormatEdit;
      try {
        edit = build();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        onError?.(error);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setErrorMessage(null);
      void onApplyEdit(edit)
        .catch((error: unknown) => {
          setErrorMessage(error instanceof Error ? error.message : String(error));
          onError?.(error);
        })
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
    },
    [onApplyEdit, onError],
  );

  const sectionProps: PptxFormatSectionProps = {
    slide,
    elementId,
    blocked,
    allowed: true,
    onApply: run,
    fillColor,
    strokeWidthEmu,
  };
  const fillAllowed = formatOpAllowed("set_fill", selectedElementType);
  const strokeAllowed = formatOpAllowed("set_stroke", selectedElementType);
  const textAllowed = formatOpAllowed("set_text_body_props", selectedElementType);

  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={t("format.loading")}
        data-pptx-format-panel
        data-state="loading"
        className={cn("p-3 text-caption text-muted-foreground", className)}
      >
        {t("format.loading")}
      </div>
    );
  }

  const blockedReason = disabled ? t("format.readonly") : !bound ? t("format.unbound") : null;

  return (
    <section
      aria-label={t("format.title")}
      data-pptx-format-panel
      data-state={busy ? "busy" : hasSelection ? "ready" : "empty"}
      className={cn("flex min-h-0 flex-col gap-4 overflow-y-auto p-3 text-body", className)}
    >
      <h2 className="text-label font-semibold text-foreground">{t("format.title")}</h2>

      {errorMessage ? (
        <Alert variant="destructive" data-testid="pptx-format-error">
          <AlertTitle>{t("format.error_title")}</AlertTitle>
          <AlertDescription>{t("format.error_hint", { message: errorMessage })}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-format-busy">
          {t("format.busy")}
        </p>
      ) : null}

      {!hasSelection ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-format-empty">
          {t("format.empty")}
        </p>
      ) : null}

      <PptxFormatFillSection {...sectionProps} allowed={fillAllowed} />
      <PptxFormatLineSection {...sectionProps} allowed={strokeAllowed} />
      <PptxFormatEffectsSection {...sectionProps} allowed={strokeAllowed} />
      <PptxFormatGeometrySection slide={slide} elementId={elementId} blocked={blocked} onApply={run} />
      <PptxFormatArrangeSection
        slide={slide}
        elementId={elementId}
        ids={ids}
        elementType={selectedElementType}
        blocked={blocked}
        onApply={run}
      />
      <PptxFormatTextSection
        slide={slide}
        elementId={elementId}
        blocked={blocked}
        allowed={textAllowed}
        onApply={run}
        textAnchor={textAnchor}
        autofit={autofit}
        wrapText={wrapText}
      />

      {blockedReason ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-format-unbound">
          {blockedReason}
        </p>
      ) : null}
    </section>
  );
}