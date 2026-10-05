"use client";

/**
 * B3ui (UNI-927) - the Charts panel: Insert, Data, Type and Style in one
 * self-contained surface over the engine's committed chart edits.
 *
 * Contract. The panel is driven by ONE optional async port and reports through
 * one error seam, exactly like the Design panel:
 *
 *   onApplyEdit?(edit: ChartEdit): Promise<unknown>   // the engine edit channel
 *   onError?(error: unknown): void                    // host reporting seam
 *
 * `onApplyEdit` receives exactly one committed `ChartEdit` union member per
 * call (`add_chart` from Insert, `set_chart` from Data/Type/Style), so the wire
 * round is a one-line binding - `(edit) => handle.edit([edit])` or
 * `model.applyEdit(edit)`. With no port bound, or no slide/chart selected, every
 * control is disabled and the panel says why: it never fakes a capability.
 *
 * States: loading (a probe is in flight), empty (no deck), no selection (no
 * chart to edit), ready, busy (an edit is applying), error (the last edit was
 * refused; the message is shown and the document is unchanged). The document is
 * only ever mutated by `onApplyEdit`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChartEdit, ChartKind } from "@uniwork/office-engine/pptx";
import {
  PPTX_CHART_KINDS,
  PPTX_CHART_LEGEND_POSITIONS,
  PPTX_CHART_PALETTES,
  buildChartDataEdit,
  buildChartStyleEdit,
  buildChartTypeEdit,
  buildInsertChartEdit,
  chartKindLabelKey,
  chartKindUsesBarDir,
  formatChartData,
  matchChartPalette,
  parseChartData,
  resolveChartKind,
  type PptxChartBarDir,
  type PptxChartData,
  type PptxChartLegendPos,
  type PptxChartResult,
} from "./chart-model";
import { ensurePptxChartsI18n } from "./charts-i18n";

export interface PptxChartsPanelProps {
  /** The engine edit channel (one committed `ChartEdit` per call). Absent ->
   *  every control is disabled with the "not bound" reason. */
  onApplyEdit?: (edit: ChartEdit) => Promise<unknown>;
  /** A refused edit surfaces here as well as in the panel's own alert. */
  onError?: (error: unknown) => void;
  /** Deck slide count; 0 means "no deck" and the panel shows its empty state. */
  slideCount?: number;
  /** 0-based selected slide; null when nothing is selected. */
  slideIndex?: number | null;
  /** Id of the selected chart element; null when no chart is selected. */
  chartElementId?: string | null;
  /** The selected chart's current kind, as read from the deck. */
  chartKind?: string | null;
  /** The selected chart's current data, for the Data editor. */
  chartData?: PptxChartData | null;
  /** The selected chart's current style, for the Style controls. */
  chartStyle?: {
    title?: string;
    legendPos?: PptxChartLegendPos;
    dataLabels?: boolean;
    gridlines?: boolean;
    colors?: readonly string[];
  } | null;
  /** A probe (capability/asset read) is in flight. */
  loading?: boolean;
  /** Explicit read-only mode (viewer permissions). */
  disabled?: boolean;
  className?: string;
}

export function PptxChartsPanel({
  onApplyEdit,
  onError,
  slideCount = 0,
  slideIndex = null,
  chartElementId = null,
  chartKind = null,
  chartData = null,
  chartStyle = null,
  loading = false,
  disabled = false,
  className,
}: PptxChartsPanelProps) {
  // Lazy: the desktop renderer imports this module before i18n is initialized.
  ensurePptxChartsI18n();
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  // The model stores each kind/palette label's FULL i18n key, so those lookups
  // must run against the root: a prefixed call would double the namespace and
  // leave the key untranslated.
  const { t: tRoot } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [insertKind, setInsertKind] = useState<ChartKind>(() => resolveChartKind(chartKind));
  const [typeKind, setTypeKind] = useState<ChartKind>(() => resolveChartKind(chartKind));
  const [barDir, setBarDir] = useState<PptxChartBarDir>("col");
  const [dataText, setDataText] = useState("");
  const [title, setTitle] = useState("");
  const [legendPos, setLegendPos] = useState<PptxChartLegendPos>("b");
  const [dataLabels, setDataLabels] = useState(false);
  const [gridlines, setGridlines] = useState(false);
  const [palette, setPalette] = useState(PPTX_CHART_PALETTES[0]?.id ?? "office");
  const busyRef = useRef(false);

  // Base UI Select requires an items label map; the SelectContent children below
  // still render the real list, so these only feed the value->label mapping.
  const kindItems = PPTX_CHART_KINDS.map((kind) => ({ value: kind, label: tRoot(chartKindLabelKey(kind)) }));
  const barDirItems = [
    { value: "col", label: t("charts.bar_dir.col") },
    { value: "bar", label: t("charts.bar_dir.bar") },
  ];
  const legendItems = PPTX_CHART_LEGEND_POSITIONS.map((position) => ({
    value: position,
    label: t("charts.legend." + position),
  }));
  const paletteItems = PPTX_CHART_PALETTES.map((entry) => ({ value: entry.id, label: tRoot(entry.labelKey) }));

  const bound = typeof onApplyEdit === "function";
  const hasDeck = slideCount > 0;
  const hasSlide = slideIndex !== null;
  const hasChart = typeof chartElementId === "string" && chartElementId.length > 0;
  const blocked = disabled || !bound || !hasDeck || busy;
  const chartBlocked = blocked || !hasSlide || !hasChart;

  // Seed the read-back controls from the deck whenever the selection changes:
  // a stale kind/legend from the previous chart must never be shown as current.
  useEffect(() => {
    setTypeKind(resolveChartKind(chartKind));
    setInsertKind(resolveChartKind(chartKind));
    setTitle(chartStyle?.title ?? "");
    setLegendPos(chartStyle?.legendPos ?? "b");
    setDataLabels(chartStyle?.dataLabels === true);
    setGridlines(chartStyle?.gridlines === true);
    setPalette(matchChartPalette(chartStyle?.colors) ?? PPTX_CHART_PALETTES[0]?.id ?? "office");
  }, [chartKind, chartStyle]);

  useEffect(() => {
    setDataText(chartData ? formatChartData(chartData) : "");
  }, [chartData]);

  const run = useCallback(
    async (result: PptxChartResult): Promise<boolean> => {
      if (!onApplyEdit || busyRef.current) return false;
      if (!result.ok) {
        setErrorMessage(result.code + ": " + result.message);
        return false;
      }
      busyRef.current = true;
      setBusy(true);
      setErrorMessage(null);
      try {
        await onApplyEdit(result.edit);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(message);
        onError?.(error);
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onApplyEdit, onError],
  );

  const insertChart = useCallback(() => {
    if (slideIndex === null) return;
    void run(buildInsertChartEdit({ slideIndex, kind: insertKind }));
  }, [run, slideIndex, insertKind]);

  const applyData = useCallback(() => {
    if (slideIndex === null || chartElementId === null) return;
    const parsed = parseChartData(dataText);
    void run(parsed.ok ? buildChartDataEdit(slideIndex, chartElementId, parsed.data) : parsed);
  }, [run, slideIndex, chartElementId, dataText]);

  const applyType = useCallback(() => {
    if (slideIndex === null || chartElementId === null) return;
    void run(
      buildChartTypeEdit(
        slideIndex,
        chartElementId,
        typeKind,
        chartKindUsesBarDir(typeKind) ? barDir : undefined,
      ),
    );
  }, [run, slideIndex, chartElementId, typeKind, barDir]);

  const applyStyle = useCallback(() => {
    if (slideIndex === null || chartElementId === null) return;
    const colors = PPTX_CHART_PALETTES.find((entry) => entry.id === palette)?.colors;
    void run(
      buildChartStyleEdit(slideIndex, chartElementId, {
        title,
        legendPos,
        dataLabels,
        gridlines,
        ...(colors ? { colors } : {}),
      }),
    );
  }, [run, slideIndex, chartElementId, title, legendPos, dataLabels, gridlines, palette]);

  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={t("charts.loading")}
        data-pptx-charts-panel
        data-state="loading"
        className={cn("flex flex-col gap-3 p-3", className)}
      >
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!hasDeck) {
    return (
      <div
        data-pptx-charts-panel
        data-state="empty"
        className={cn("p-3 text-caption text-muted-foreground", className)}
      >
        {t("charts.empty")}
      </div>
    );
  }

  const blockedReason = disabled
    ? t("charts.readonly")
    : !bound
      ? t("charts.unbound")
      : !hasSlide
        ? t("charts.no_slide")
        : null;
  const selectionReason = !hasSlide ? t("charts.no_slide") : !hasChart ? t("charts.no_selection") : null;

  return (
    <section
      aria-label={t("charts.title")}
      data-pptx-charts-panel
      data-state={busy ? "busy" : "ready"}
      className={cn("flex min-h-0 flex-col gap-4 overflow-y-auto p-3", className)}
    >
      {errorMessage ? (
        <Alert variant="destructive" data-testid="pptx-charts-error">
          <AlertTitle>{t("charts.error_title")}</AlertTitle>
          <AlertDescription>{t("charts.error_hint", { message: errorMessage })}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-charts-busy">
          {t("charts.busy")}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5" data-pptx-charts-insert>
        <span className="text-caption font-medium text-muted-foreground">{t("charts.insert_section")}</span>
        <p className="text-caption text-muted-foreground">{t("charts.insert_hint")}</p>
        <Select
          items={kindItems}
          value={insertKind}
          onValueChange={(value) => setInsertKind(resolveChartKind(value))}
        >
          <SelectTrigger aria-label={t("charts.type_label")} className="w-full" disabled={blocked || !hasSlide}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PPTX_CHART_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {tRoot(chartKindLabelKey(kind))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={blocked || !hasSlide}
          data-testid="pptx-charts-insert"
          onClick={insertChart}
        >
          {t("charts.insert")}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5" data-pptx-charts-data>
        <span className="text-caption font-medium text-muted-foreground">{t("charts.data_section")}</span>
        <Label htmlFor="pptx-charts-data-text" className="text-caption text-muted-foreground">
          {t("charts.data_label")}
        </Label>
        <Textarea
          id="pptx-charts-data-text"
          value={dataText}
          disabled={chartBlocked}
          aria-label={t("charts.data_label")}
          className="min-h-24 font-mono text-caption"
          data-testid="pptx-charts-data-text"
          onChange={(event) => setDataText(event.target.value)}
        />
        <p className="text-caption text-muted-foreground">{t("charts.data_hint")}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={chartBlocked}
          data-testid="pptx-charts-data-apply"
          onClick={applyData}
        >
          {t("charts.data_apply")}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5" data-pptx-charts-type>
        <span className="text-caption font-medium text-muted-foreground">{t("charts.type_section")}</span>
        <Label htmlFor="pptx-charts-type-select" className="text-caption text-muted-foreground">
          {t("charts.type_label")}
        </Label>
        <Select items={kindItems} value={typeKind} onValueChange={(value) => setTypeKind(resolveChartKind(value))}>
          <SelectTrigger
            id="pptx-charts-type-select"
            aria-label={t("charts.type_label")}
            className="w-full"
            disabled={chartBlocked}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PPTX_CHART_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {tRoot(chartKindLabelKey(kind))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {chartKindUsesBarDir(typeKind) ? (
          <>
            <Label htmlFor="pptx-charts-bar-dir" className="text-caption text-muted-foreground">
              {t("charts.bar_dir_label")}
            </Label>
            <Select
              items={barDirItems}
              value={barDir}
              onValueChange={(value) => setBarDir(value === "bar" ? "bar" : "col")}
            >
              <SelectTrigger
                id="pptx-charts-bar-dir"
                aria-label={t("charts.bar_dir_label")}
                className="w-full"
                disabled={chartBlocked}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="col">{t("charts.bar_dir.col")}</SelectItem>
                <SelectItem value="bar">{t("charts.bar_dir.bar")}</SelectItem>
              </SelectContent>
            </Select>
          </>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={chartBlocked}
          data-testid="pptx-charts-type-apply"
          onClick={applyType}
        >
          {t("charts.type_section")}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5" data-pptx-charts-style>
        <span className="text-caption font-medium text-muted-foreground">{t("charts.style_section")}</span>
        <Label htmlFor="pptx-charts-title" className="text-caption text-muted-foreground">
          {t("charts.title_label")}
        </Label>
        <Input
          id="pptx-charts-title"
          value={title}
          disabled={chartBlocked}
          placeholder={t("charts.title_placeholder")}
          className="h-7"
          data-testid="pptx-charts-title"
          onChange={(event) => setTitle(event.target.value)}
        />
        <Label htmlFor="pptx-charts-legend" className="text-caption text-muted-foreground">
          {t("charts.legend_label")}
        </Label>
        <Select
          items={legendItems}
          value={legendPos}
          onValueChange={(value) =>
            setLegendPos(
              value !== null && (PPTX_CHART_LEGEND_POSITIONS as readonly string[]).includes(value)
                ? (value as PptxChartLegendPos)
                : "b",
            )
          }
        >
          <SelectTrigger
            id="pptx-charts-legend"
            aria-label={t("charts.legend_label")}
            className="w-full"
            disabled={chartBlocked}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PPTX_CHART_LEGEND_POSITIONS.map((position) => (
              <SelectItem key={position} value={position}>
                {t("charts.legend." + position)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label htmlFor="pptx-charts-palette" className="text-caption text-muted-foreground">
          {t("charts.palette_label")}
        </Label>
        <Select
          items={paletteItems}
          value={palette}
          onValueChange={(value) => setPalette(value ?? PPTX_CHART_PALETTES[0]?.id ?? "office")}
        >
          <SelectTrigger
            id="pptx-charts-palette"
            aria-label={t("charts.palette_label")}
            className="w-full"
            disabled={chartBlocked}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PPTX_CHART_PALETTES.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {tRoot(entry.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="flex items-center gap-2">
          <Checkbox
            id="pptx-charts-labels"
            checked={dataLabels}
            disabled={chartBlocked}
            aria-label={t("charts.data_labels")}
            onCheckedChange={(checked) => setDataLabels(checked === true)}
          />
          <Label htmlFor="pptx-charts-labels">{t("charts.data_labels")}</Label>
        </span>
        <span className="flex items-center gap-2">
          <Checkbox
            id="pptx-charts-gridlines"
            checked={gridlines}
            disabled={chartBlocked}
            aria-label={t("charts.gridlines")}
            onCheckedChange={(checked) => setGridlines(checked === true)}
          />
          <Label htmlFor="pptx-charts-gridlines">{t("charts.gridlines")}</Label>
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={chartBlocked}
          data-testid="pptx-charts-style-apply"
          onClick={applyStyle}
        >
          {t("charts.style_apply")}
        </Button>
      </div>

      {blockedReason ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-charts-unbound">
          {blockedReason}
        </p>
      ) : null}
      {!blockedReason && selectionReason ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-charts-no-selection">
          {selectionReason}
        </p>
      ) : null}
    </section>
  );
}