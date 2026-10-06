import { attribute, decodeXml, elements } from "./render-model-xml.ts";
import { parseColorXml, resolvedColor } from "./render-model-styles.ts";
import type { XlsxRenderMerge } from "./render-model.ts";

/** Classic worksheet CF payload consumed by the pinned renderer. */
export interface XlsxRenderConditionalRule {
  ranges: XlsxRenderMerge[];
  ruleType: string;
  operator?: string;
  formulas: string[];
  text?: string;
  dxfIndex?: number;
  priority: number;
  stopIfTrue?: boolean;
  rank?: number;
  percent: boolean;
  bottom: boolean;
  cfvos: { kind: string; value?: string; gte?: boolean }[];
  colors: string[];
  iconSetName?: string;
  iconReverse: boolean;
  showValue: boolean;
}

export function parseConditionalRules(
  xml: string,
  parseRange: (ref: string) => XlsxRenderMerge | null,
  palette: readonly string[] | undefined,
): XlsxRenderConditionalRule[] {
  const rules: XlsxRenderConditionalRule[] = [];
  const flag = (tag: string, name: string) => /^(1|true)$/.test(attribute(tag, name) ?? "");
  for (const block of elements(xml, "conditionalFormatting")) {
    const ranges = (attribute(block.tag, "sqref") ?? "").trim().split(/\s+/)
      .map(parseRange).filter((range): range is XlsxRenderMerge => range !== null);
    if (!ranges.length) continue;
    for (const rule of elements(block.body, "cfRule")) {
      const ruleType = attribute(rule.tag, "type");
      const priority = Number(attribute(rule.tag, "priority"));
      if (!ruleType || !Number.isInteger(priority) || priority < 1) continue;
      const dxf = attribute(rule.tag, "dxfId");
      const rank = attribute(rule.tag, "rank");
      const icon = elements(rule.body, "iconSet")[0];
      const bar = elements(rule.body, "dataBar")[0];
      const operator = attribute(rule.tag, "operator");
      const text = attribute(rule.tag, "text");
      rules.push({
        ranges, ruleType, priority,
        ...(operator === undefined ? {} : { operator }),
        ...(text === undefined ? {} : { text: decodeXml(text) }),
        ...(dxf === undefined || !/^\d+$/.test(dxf) ? {} : { dxfIndex: Number(dxf) }),
        ...(rank === undefined || !/^\d+$/.test(rank) ? {} : { rank: Number(rank) }),
        ...(attribute(rule.tag, "stopIfTrue") === undefined ? {} : { stopIfTrue: flag(rule.tag, "stopIfTrue") }),
        formulas: elements(rule.body, "formula").map((formula) => decodeXml(formula.body)),
        percent: flag(rule.tag, "percent"), bottom: flag(rule.tag, "bottom"),
        cfvos: elements(rule.body, "cfvo").map((value) => ({
          kind: attribute(value.tag, "type") ?? "num",
          ...(attribute(value.tag, "val") === undefined ? {} : { value: decodeXml(attribute(value.tag, "val")!) }),
          ...(attribute(value.tag, "gte") === undefined ? {} : { gte: flag(value.tag, "gte") }),
        })),
        colors: elements(rule.body, "color").flatMap((color) => {
          const rgb = resolvedColor(parseColorXml(color.tag), palette).rgb;
          return rgb ? [rgb] : [];
        }),
        ...(icon && attribute(icon.tag, "iconSet") ? { iconSetName: attribute(icon.tag, "iconSet")! } : {}),
        iconReverse: icon ? flag(icon.tag, "reverse") : false,
        showValue: !/^(0|false)$/.test(attribute(icon?.tag ?? bar?.tag ?? "", "showValue") ?? ""),
      });
    }
  }
  return rules;
}
