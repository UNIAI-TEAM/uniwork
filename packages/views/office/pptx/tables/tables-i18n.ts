/**
 * Tables panel i18n (B2ui, UNI-927) - the panel's own dictionary.
 *
 * The shared locale files (`packages/core/i18n/locales/{en,vi}.json`) are edited
 * by the serialized UI-wire round, so this panel keeps every string it renders
 * in its own file: a flat map of the exact `office.pptx.tables.*` keys the
 * components pass to `t()`, each with its `en` and `vi` copy. Key parity is a
 * hard rule: both locales exist for every key and both carry the same `{{vars}}`
 * - `tables-i18n.test.ts` proves it.
 */
export interface PptxTablesI18nEntry {
  en: string;
  vi: string;
}

/** Every `office.pptx.tables.*` key this panel renders, in source order. */
export const PPTX_TABLES_I18N: Readonly<Record<string, PptxTablesI18nEntry>> = {
  "office.pptx.tables.title": { en: "Tables", vi: "B\u1ea3ng" },
  "office.pptx.tables.loading": { en: "Loading table options...", vi: "\u0110ang t\u1ea3i tu\u1ef3 ch\u1ecdn b\u1ea3ng..." },
  "office.pptx.tables.empty": { en: "Select a table to edit it", vi: "Ch\u1ecdn m\u1ed9t b\u1ea3ng \u0111\u1ec3 ch\u1ec9nh s\u1eeda" },
  "office.pptx.tables.busy": { en: "Applying...", vi: "\u0110ang \u00e1p d\u1ee5ng..." },
  "office.pptx.tables.error_title": { en: "The table change could not be applied", vi: "Kh\u00f4ng th\u1ec3 \u00e1p d\u1ee5ng thay \u0111\u1ed5i b\u1ea3ng" },
  "office.pptx.tables.error_hint": { en: "The document was not changed. {{message}}", vi: "T\u00e0i li\u1ec7u ch\u01b0a b\u1ecb thay \u0111\u1ed5i. {{message}}" },
  "office.pptx.tables.unbound": { en: "Table changes are not connected to this editor yet.", vi: "Thay \u0111\u1ed5i b\u1ea3ng ch\u01b0a \u0111\u01b0\u1ee3c k\u1ebft n\u1ed1i v\u1edbi tr\u00ecnh so\u1ea1n th\u1ea3o n\u00e0y." },
  "office.pptx.tables.readonly": { en: "This presentation is read-only.", vi: "B\u1ea3n tr\u00ecnh b\u00e0y n\u00e0y ch\u1ec9 \u0111\u1ecdc." },
  "office.pptx.tables.no_table": { en: "Select a table on the slide to edit it.", vi: "Ch\u1ecdn m\u1ed9t b\u1ea3ng tr\u00ean trang chi\u1ebfu \u0111\u1ec3 ch\u1ec9nh s\u1eeda." },
  "office.pptx.tables.no_cell": { en: "Select a cell in the table.", vi: "Ch\u1ecdn m\u1ed9t \u00f4 trong b\u1ea3ng." },
  "office.pptx.tables.target": { en: "Table {{rows}} x {{cols}}", vi: "B\u1ea3ng {{rows}} x {{cols}}" },
  "office.pptx.tables.cell_label": { en: "Cell ({{row}}, {{col}})", vi: "\u00d4 ({{row}}, {{col}})" },

  "office.pptx.tables.insert.label": { en: "New table", vi: "B\u1ea3ng m\u1edbi" },
  "office.pptx.tables.insert.rows": { en: "Rows", vi: "S\u1ed1 h\u00e0ng" },
  "office.pptx.tables.insert.cols": { en: "Columns", vi: "S\u1ed1 c\u1ed9t" },
  "office.pptx.tables.insert.apply": { en: "Insert table", vi: "Ch\u00e8n b\u1ea3ng" },
  "office.pptx.tables.insert.invalid": { en: "Enter rows and columns from 1 to 20.", vi: "Nh\u1eadp s\u1ed1 h\u00e0ng v\u00e0 s\u1ed1 c\u1ed9t t\u1eeb 1 \u0111\u1ebfn 20." },

  "office.pptx.tables.cell.label": { en: "Cell text", vi: "N\u1ed9i dung \u00f4" },
  "office.pptx.tables.cell.text": { en: "Text", vi: "V\u0103n b\u1ea3n" },
  "office.pptx.tables.cell.apply": { en: "Apply text", vi: "\u00c1p d\u1ee5ng" },
  "office.pptx.tables.cell.anchor_label": { en: "Vertical align", vi: "C\u0103n d\u1ecdc" },
  "office.pptx.tables.cell.anchor.top": { en: "Top", vi: "Tr\u00ean" },
  "office.pptx.tables.cell.anchor.middle": { en: "Middle", vi: "Gi\u1eefa" },
  "office.pptx.tables.cell.anchor.bottom": { en: "Bottom", vi: "D\u01b0\u1edbi" },

  "office.pptx.tables.structure.label": { en: "Rows and columns", vi: "H\u00e0ng v\u00e0 c\u1ed9t" },
  "office.pptx.tables.structure.insert_row": { en: "Insert row", vi: "Th\u00eam h\u00e0ng" },
  "office.pptx.tables.structure.delete_row": { en: "Delete row", vi: "X\u00f3a h\u00e0ng" },
  "office.pptx.tables.structure.insert_col": { en: "Insert column", vi: "Th\u00eam c\u1ed9t" },
  "office.pptx.tables.structure.delete_col": { en: "Delete column", vi: "X\u00f3a c\u1ed9t" },
  "office.pptx.tables.structure.row_height": { en: "Row height (px)", vi: "Chi\u1ec1u cao h\u00e0ng (px)" },
  "office.pptx.tables.structure.col_width": { en: "Column width (px)", vi: "Chi\u1ec1u r\u1ed9ng c\u1ed9t (px)" },
  "office.pptx.tables.structure.apply_size": { en: "Apply size", vi: "\u00c1p d\u1ee5ng k\u00edch th\u01b0\u1edbc" },
  "office.pptx.tables.structure.size_invalid": { en: "Enter a positive size.", vi: "Nh\u1eadp k\u00edch th\u01b0\u1edbc l\u1edbn h\u01a1n 0." },

  "office.pptx.tables.merge.label": { en: "Merge", vi: "G\u1ed9p \u00f4" },
  "office.pptx.tables.merge.right": { en: "Merge right", vi: "G\u1ed9p sang ph\u1ea3i" },
  "office.pptx.tables.merge.down": { en: "Merge down", vi: "G\u1ed9p xu\u1ed1ng" },
  "office.pptx.tables.merge.split": { en: "Split cell", vi: "T\u00e1ch \u00f4" },

  "office.pptx.tables.style.label": { en: "Table style", vi: "Ki\u1ec3u b\u1ea3ng" },
  "office.pptx.tables.style.group_label": { en: "Table style gallery", vi: "Th\u01b0 vi\u1ec7n ki\u1ec3u b\u1ea3ng" },
  "office.pptx.tables.style.apply": { en: "Apply style {{name}}", vi: "\u00c1p d\u1ee5ng ki\u1ec3u {{name}}" },
  "office.pptx.tables.style.active": { en: "{{name}} (current style)", vi: "{{name}} (ki\u1ec3u hi\u1ec7n t\u1ea1i)" },
  "office.pptx.tables.style.preset.none": { en: "No style", vi: "Kh\u00f4ng ki\u1ec3u" },
  "office.pptx.tables.style.preset.lightGrid": { en: "Light grid", vi: "L\u01b0\u1edbi s\u00e1ng" },
  "office.pptx.tables.style.preset.zebraBlue": { en: "Banded blue", vi: "S\u1ecdc xanh d\u01b0\u01a1ng" },
  "office.pptx.tables.style.preset.zebraGray": { en: "Banded gray", vi: "S\u1ecdc x\u00e1m" },
  "office.pptx.tables.style.preset.headerDarkBlue": { en: "Dark blue header", vi: "\u0110\u1ea7u b\u1ea3ng xanh \u0111\u1eadm" },
  "office.pptx.tables.style.preset.headerOrange": { en: "Orange header", vi: "\u0110\u1ea7u b\u1ea3ng cam" },
  "office.pptx.tables.style.preset.noBorder": { en: "Minimal (no borders)", vi: "T\u1ed1i gi\u1ea3n (kh\u00f4ng vi\u1ec1n)" },
  "office.pptx.tables.style.preset.fullBorder": { en: "All borders", vi: "T\u1ea5t c\u1ea3 vi\u1ec1n" },
};

/** Locales this panel ships copy for. */
export type PptxTablesLocale = "en" | "vi";

/**
 * Nest the flat key map into the shape the shared locale files use, so the
 * UI-wire round can merge it verbatim (`office.pptx.tables.*` -> nested
 * objects). Pure: no i18next instance is touched here.
 */
export function tablesPanelDictionary(locale: PptxTablesLocale): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(PPTX_TABLES_I18N)) {
    const parts = key.split(".");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      if (typeof next !== "object" || next === null) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1] as string] = entry[locale];
  }
  return root;
}