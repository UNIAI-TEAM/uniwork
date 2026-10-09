"use client";

// B8 (UNI-924): insert-chart dialog. Pick bar/line/pie, enter (or import from
// the selected table) the categories/series grid and insert; the chart renders
// immediately through the vendored docProtected node view and the save embeds
// the chart part. The actual node insertion goes through DocxChartEditing.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChartColumn, ChartLine, ChartPie, Plus, Trash2 } from "lucide-react";
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
import type { DocxChartEditing } from "./docx-chart-commands";
import {
  chartDisplayFromSpec,
  chartDraftError,
  chartDraftToSpec,
  DOCX_CHART_KINDS,
  formatDocxChartValue,
  normalizeDocxChartDraft,
  parseDocxChartNumber,
  type DocxChartDraft,
  type DocxChartKind,
} from "./docx-chart-model";

export interface DocxChartInsertProps {
  editing: DocxChartEditing;
  readOnly?: boolean;
  className?: string;
  /** The current selection is a table the dialog will seed from. */
  hasTable?: boolean;
}

interface SeriesRow {
  name: string;
  /** Raw grid text; parsed to number|null when the draft is built. */
  values: string[];
}

const KIND_ICONS: Record<DocxChartKind, typeof ChartColumn> = {
  bar: ChartColumn,
  line: ChartLine,
  pie: ChartPie,
};

const DEFAULT_CATEGORIES = ["", "", ""];

export function DocxChartInsert({ editing, readOnly = false, className, hasTable = false }: DocxChartInsertProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DocxChartKind>("bar");
  const [title, setTitle] = useState("");
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [series, setSeries] = useState<SeriesRow[]>([{ name: "", values: ["", "", ""] }]);
  const [fromTable, setFromTable] = useState(false);

  const openDialog = () => {
    const table = editing.readSelectedTable();
    if (table) {
      setCategories(table.categories);
      setSeries(table.series.map((entry) => ({
        name: entry.name,
        values: entry.values.map(formatDocxChartValue),
      })));
      setFromTable(true);
    } else {
      setCategories(DEFAULT_CATEGORIES);
      setSeries([{ name: "", values: ["", "", ""] }]);
      setFromTable(false);
    }
    setKind("bar");
    setTitle("");
    setOpen(true);
  };

  const draft: DocxChartDraft = {
    kind,
    title,
    categories,
    series: series.map((entry) => ({ name: entry.name, values: entry.values.map(parseDocxChartNumber) })),
  };
  const effective = normalizeDocxChartDraft(draft, (index) => t("office.docx.charts.seriesDefault", { num: index + 1 }));
  const failure = chartDraftError(effective);

  const changeCategory = (at: number, value: string) => {
    setCategories((current) => current.map((category, index) => (index === at ? value : category)));
  };

  const addCategory = () => {
    setCategories((current) => [...current, ""]);
    setSeries((current) => current.map((entry) => ({ ...entry, values: [...entry.values, ""] })));
  };

  const changeSeriesName = (at: number, value: string) => {
    setSeries((current) => current.map((entry, index) => (index === at ? { ...entry, name: value } : entry)));
  };

  const changeValue = (row: number, at: number, value: string) => {
    setSeries((current) => current.map((entry, index) => (
      index === row ? { ...entry, values: entry.values.map((cell, cellIndex) => (cellIndex === at ? value : cell)) } : entry
    )));
  };

  const addSeries = () => {
    setSeries((current) => [...current, { name: "", values: categories.map(() => "") }]);
  };

  const removeSeries = (at: number) => {
    setSeries((current) => current.filter((_, index) => index !== at));
  };

  const commit = () => {
    const spec = chartDraftToSpec(effective);
    if (!spec) return;
    const inserted = editing.insert({
      chart: spec,
      display: chartDisplayFromSpec(spec),
      label: t("office.docx.charts.label"),
    });
    if (inserted) setOpen(false);
  };

  return (
    <div className={className}>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.charts.insert")}
        title={hasTable ? t("office.docx.charts.insertFromTable") : t("office.docx.charts.insert")}
        disabled={readOnly || !editing.canInsert()}
        onClick={openDialog}
        data-testid="docx-chart-insert-button"
      >
        <ChartColumn aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t("office.docx.charts.close")} className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("office.docx.charts.insertTitle")}</DialogTitle>
            <DialogDescription data-testid="docx-chart-hint">
              {fromTable ? t("office.docx.charts.fromTable") : t("office.docx.charts.insertHint")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-caption text-muted-foreground">{t("office.docx.charts.type")}</span>
              {DOCX_CHART_KINDS.map((option) => {
                const Icon = KIND_ICONS[option];
                return (
                  <Button
                    key={option}
                    type="button"
                    variant="toolbar"
                    size="sm"
                    className="gap-1.5"
                    aria-pressed={kind === option}
                    onClick={() => setKind(option)}
                    data-testid={"docx-chart-kind-" + option}
                  >
                    <Icon aria-hidden />
                    <span>{t("office.docx.charts.kinds." + option)}</span>
                  </Button>
                );
              })}
            </div>
            <div className="grid gap-1">
              <Label htmlFor="docx-chart-title">{t("office.docx.charts.title")}</Label>
              <Input
                id="docx-chart-title"
                value={title}
                placeholder={t("office.docx.charts.titlePlaceholder")}
                onChange={(event) => setTitle(event.target.value)}
                data-testid="docx-chart-title-input"
              />
            </div>
            <div className="grid gap-1">
              <span className="text-caption text-muted-foreground">{t("office.docx.charts.data")}</span>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse" data-testid="docx-chart-grid">
                  <thead>
                    <tr>
                      <th scope="col" className="p-1 text-left text-caption font-normal text-muted-foreground">
                        {t("office.docx.charts.dataCorner")}
                      </th>
                      {categories.map((category, column) => (
                        <th key={column} scope="col" className="p-1">
                          <Input
                            value={category}
                            aria-label={t("office.docx.charts.categoryLabel", { num: column + 1 })}
                            placeholder={t("office.docx.charts.categoryPlaceholder", { num: column + 1 })}
                            onChange={(event) => changeCategory(column, event.target.value)}
                            data-testid={"docx-chart-category-" + column}
                          />
                        </th>
                      ))}
                      <th scope="col" className="p-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("office.docx.charts.addCategory")}
                          onClick={addCategory}
                          data-testid="docx-chart-add-category"
                        >
                          <Plus aria-hidden />
                        </Button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {series.map((row, index) => (
                      <tr key={index}>
                        <th scope="row" className="p-1">
                          <Input
                            value={row.name}
                            aria-label={t("office.docx.charts.seriesName", { num: index + 1 })}
                            placeholder={t("office.docx.charts.seriesPlaceholder")}
                            onChange={(event) => changeSeriesName(index, event.target.value)}
                            data-testid={"docx-chart-series-name-" + index}
                          />
                        </th>
                        {categories.map((_, column) => (
                          <td key={column} className="p-1">
                            <Input
                              inputMode="decimal"
                              value={row.values[column] ?? ""}
                              aria-label={t("office.docx.charts.valueLabel", { num: column + 1 })}
                              onChange={(event) => changeValue(index, column, event.target.value)}
                              data-testid={"docx-chart-value-" + index + "-" + column}
                            />
                          </td>
                        ))}
                        <td className="p-1">
                          {series.length > 1 ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("office.docx.charts.removeSeries", { num: index + 1 })}
                              onClick={() => removeSeries(index)}
                              data-testid={"docx-chart-remove-series-" + index}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={addSeries}
                  data-testid="docx-chart-add-series"
                >
                  <Plus aria-hidden />
                  <span>{t("office.docx.charts.addSeries")}</span>
                </Button>
              </div>
              {failure ? (
                <p className="text-caption text-destructive" role="alert" data-testid="docx-chart-error">
                  {t("office.docx.charts.errors." + failure)}
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("office.docx.charts.cancel")}
            </Button>
            <Button type="button" onClick={commit} disabled={failure !== null} data-testid="docx-chart-insert-confirm">
              {t("office.docx.charts.insert")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
