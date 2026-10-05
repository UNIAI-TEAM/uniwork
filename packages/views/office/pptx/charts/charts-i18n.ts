/**
 * B3ui (UNI-927) - the Charts panel's own i18n keys.
 *
 * Same self-contained contract as the Design/Transitions/Animations panes: the
 * SHARED locale files (packages/core/i18n/locales/{en,vi}.json) belong to the
 * serialized UI-wire round, so the panel carries its keys here and registers
 * them into the shared i18next instance on import. The wire round copies the
 * same entries into en.json/vi.json; i18next keeps the locale file's value once
 * it lands (addResourceBundle overwrite=false), so nothing here needs a second
 * edit.
 *
 * Keys are the exact office.pptx.charts.* paths the panel passes to t().
 */
import { createPptxI18nRegistrar } from "../i18n-registrar";
import { CHART_KINDS } from "@uniwork/office-engine/pptx";
import { chartKindLabelKey } from "./chart-model";

/** One key's copy in both supported locales. */
export interface PptxChartsI18nEntry {
  en: string;
  vi: string;
}

/** Flat office.pptx.charts.* key -> { en, vi }. The UI-wire round copies these. */
export const PPTX_CHARTS_I18N: Readonly<Record<string, PptxChartsI18nEntry>> = {
  "office.pptx.charts.title": { en: "Charts", vi: "Biểu đồ" },
  "office.pptx.charts.loading": { en: "Loading the chart tools...", vi: "Đang tải công cụ biểu đồ..." },
  "office.pptx.charts.empty": {
    en: "Open a presentation to insert a chart",
    vi: "Mở một bản trình bày để chèn biểu đồ",
  },
  "office.pptx.charts.no_slide": {
    en: "Select a slide to insert a chart.",
    vi: "Chọn một trang để chèn biểu đồ.",
  },
  "office.pptx.charts.no_selection": {
    en: "Select a chart on the slide to edit its data, type or style.",
    vi: "Chọn một biểu đồ trên trang để sửa dữ liệu, kiểu hoặc định dạng.",
  },
  "office.pptx.charts.unbound": {
    en: "Chart edits are not connected to this editor yet.",
    vi: "Chỉnh sửa biểu đồ chưa được nối vào trình soạn thảo này.",
  },
  "office.pptx.charts.readonly": { en: "This presentation is read-only.", vi: "Bản trình bày này chỉ đọc." },
  "office.pptx.charts.busy": { en: "Applying...", vi: "Đang áp dụng..." },
  "office.pptx.charts.error_title": {
    en: "The chart change could not be applied",
    vi: "Không thể áp dụng thay đổi biểu đồ",
  },
  "office.pptx.charts.error_hint": {
    en: "The document was not changed. {{message}}",
    vi: "Tài liệu chưa bị thay đổi. {{message}}",
  },
  "office.pptx.charts.insert_section": { en: "Insert chart", vi: "Chèn biểu đồ" },
  "office.pptx.charts.insert_hint": {
    en: "Inserts a chart on the current slide.",
    vi: "Chèn một biểu đồ vào trang hiện tại.",
  },
  "office.pptx.charts.insert": { en: "Insert chart", vi: "Chèn biểu đồ" },
  "office.pptx.charts.data_section": { en: "Chart data", vi: "Dữ liệu biểu đồ" },
  "office.pptx.charts.data_label": { en: "Categories and series", vi: "Danh mục và chuỗi" },
  "office.pptx.charts.data_hint": {
    en: "First row names the series; each later row is a category and its values.",
    vi: "Hàng đầu đặt tên chuỗi; mỗi hàng sau là một danh mục và các giá trị.",
  },
  "office.pptx.charts.data_apply": { en: "Apply data", vi: "Áp dụng dữ liệu" },
  "office.pptx.charts.type_section": { en: "Chart type", vi: "Kiểu biểu đồ" },
  "office.pptx.charts.type_label": { en: "Type", vi: "Kiểu" },
  "office.pptx.charts.bar_dir_label": { en: "Bar direction", vi: "Hướng cột" },
  "office.pptx.charts.bar_dir.col": { en: "Vertical", vi: "Dọc" },
  "office.pptx.charts.bar_dir.bar": { en: "Horizontal", vi: "Ngang" },
  "office.pptx.charts.style_section": { en: "Chart style", vi: "Định dạng biểu đồ" },
  "office.pptx.charts.title_label": { en: "Chart title", vi: "Tiêu đề biểu đồ" },
  "office.pptx.charts.title_placeholder": { en: "Chart title", vi: "Tiêu đề biểu đồ" },
  "office.pptx.charts.legend_label": { en: "Legend", vi: "Chú giải" },
  "office.pptx.charts.legend.b": { en: "Bottom", vi: "Dưới" },
  "office.pptx.charts.legend.t": { en: "Top", vi: "Trên" },
  "office.pptx.charts.legend.r": { en: "Right", vi: "Phải" },
  "office.pptx.charts.legend.l": { en: "Left", vi: "Trái" },
  "office.pptx.charts.legend.none": { en: "None", vi: "Không" },
  "office.pptx.charts.data_labels": { en: "Data labels", vi: "Nhãn dữ liệu" },
  "office.pptx.charts.gridlines": { en: "Gridlines", vi: "Đường lưới" },
  "office.pptx.charts.palette_label": { en: "Colours", vi: "Màu sắc" },
  "office.pptx.charts.style_apply": { en: "Apply style", vi: "Áp dụng định dạng" },
  "office.pptx.charts.palette.office": { en: "Office", vi: "Office" },
  "office.pptx.charts.palette.warm": { en: "Warm", vi: "Ấm" },
  "office.pptx.charts.palette.cool": { en: "Cool", vi: "Lạnh" },
  "office.pptx.charts.palette.mono": { en: "Monochrome", vi: "Đơn sắc" },
  "office.pptx.charts.kind.bar": { en: "Clustered column", vi: "Cột nhóm" },
  "office.pptx.charts.kind.bar_stacked": { en: "Stacked column", vi: "Cột xếp chồng" },
  "office.pptx.charts.kind.bar_percent_stacked": { en: "100% stacked column", vi: "Cột xếp chồng 100%" },
  "office.pptx.charts.kind.line": { en: "Line", vi: "Đường" },
  "office.pptx.charts.kind.area": { en: "Area", vi: "Vùng" },
  "office.pptx.charts.kind.pie": { en: "Pie", vi: "Tròn" },
  "office.pptx.charts.kind.doughnut": { en: "Doughnut", vi: "Vành khuyên" },
  "office.pptx.charts.kind.scatter": { en: "Scatter", vi: "Phân tán" },
  "office.pptx.charts.kind.radar": { en: "Radar", vi: "Radar" },
  "office.pptx.charts.kind.combo_bar_line": { en: "Combo", vi: "Kết hợp" },
  "office.pptx.charts.kind.pie_3d": { en: "3-D pie", vi: "Tròn 3-D" },
  "office.pptx.charts.kind.bar_3d": { en: "3-D column", vi: "Cột 3-D" },
};

/** Locales this panel ships copy for. */
export type PptxChartsLocale = "en" | "vi";

/** Flat keys nested by dot, for one locale: { office: { pptx: { charts: ... } } }. */
export function pptxChartsResources(locale: PptxChartsLocale): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(PPTX_CHARTS_I18N)) {
    const parts = key.split(".");
    let node = out;
    for (const part of parts.slice(0, -1)) {
      const existing = node[part];
      const next = existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
      node[part] = next;
      node = next;
    }
    node[parts[parts.length - 1] as string] = entry[locale];
  }
  return out;
}

/** Registers the panel's keys for every loaded locale (overwrite=false, so the
 * locale files win once the keys land there). Lazy and idempotent: importing
 * this module never touches i18next, the panel calls it on render. */
export const ensurePptxChartsI18n = createPptxI18nRegistrar(pptxChartsResources);

/** Every kind must carry a label key; exported so the parity test can pin it. */
export const PPTX_CHARTS_KIND_KEYS: readonly string[] = CHART_KINDS.map((kind) => chartKindLabelKey(kind));