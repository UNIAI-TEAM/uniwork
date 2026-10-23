// Worksheet data-validation reader (X01). Mirrors the genoffice sidecar's
// parse_dv_rule (native/xlsx-engine/src/worksheet.rs) field for field, so the
// pinned loader's toUniverDvRule installs a file's own rules exactly as the
// desktop app does - and a declarative DV save, which rewrites the whole
// <dataValidations> section from the live model, keeps them. Only classic
// rules carry a `sqref` attribute; x14 rules (extLst) are not read.
import { attribute, decodeXml, elements } from "./render-model-xml.ts";
import type { XlsxRenderMerge } from "./render-model.ts";

/** One classic worksheet data-validation rule (the vendored
 *  WorkbookRangeResult.dataValidations entry). Formulas keep their file text:
 *  a literal list stays quoted (`"Yes,No"`), a reference stays bare. */
export interface XlsxRenderDataValidation {
  ranges: XlsxRenderMerge[];
  ruleType: string;
  operator?: string;
  formulas: string[];
  allowBlank: boolean;
  /** Raw OOXML showDropDown flag - true SUPPRESSES the in-cell dropdown. */
  suppressDropdown: boolean;
  showInputMessage: boolean;
  showErrorMessage: boolean;
  errorStyle?: string;
  errorTitle?: string;
  error?: string;
  promptTitle?: string;
  prompt?: string;
}

export function parseDataValidations(
  xml: string,
  parseRange: (ref: string) => XlsxRenderMerge | null,
): XlsxRenderDataValidation[] {
  const rules: XlsxRenderDataValidation[] = [];
  const flag = (tag: string, name: string) => /^(1|true)$/.test(attribute(tag, name) ?? "");
  const text = (tag: string, name: string): Record<string, string> => {
    const value = attribute(tag, name);
    return value === undefined ? {} : { [name]: decodeXml(value) };
  };
  for (const rule of elements(xml, "dataValidation")) {
    const sqref = attribute(rule.tag, "sqref");
    if (sqref === undefined) continue;
    const ranges = sqref.trim().split(/\s+/)
      .map(parseRange).filter((range): range is XlsxRenderMerge => range !== null);
    if (!ranges.length) continue;
    const operator = attribute(rule.tag, "operator");
    rules.push({
      ranges,
      ruleType: attribute(rule.tag, "type") ?? "none",
      ...(operator === undefined ? {} : { operator }),
      formulas: [...elements(rule.body, "formula1"), ...elements(rule.body, "formula2")]
        .map((formula) => decodeXml(formula.body)),
      allowBlank: flag(rule.tag, "allowBlank"),
      suppressDropdown: flag(rule.tag, "showDropDown"),
      showInputMessage: flag(rule.tag, "showInputMessage"),
      showErrorMessage: flag(rule.tag, "showErrorMessage"),
      ...text(rule.tag, "errorStyle"),
      ...text(rule.tag, "errorTitle"),
      ...text(rule.tag, "error"),
      ...text(rule.tag, "promptTitle"),
      ...text(rule.tag, "prompt"),
    });
  }
  return rules;
}
