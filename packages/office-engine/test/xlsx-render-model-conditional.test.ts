import { describe, expect, it } from "vitest";
import { parseConditionalRules } from "../src/xlsx/render-model-conditional";

const range = (ref: string) => (ref ? { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0, ref } : null);

describe("parseConditionalRules linked x14 flag (review dvcf B2)", () => {
  it("flags the classic half of an Excel linked rule and nothing else", () => {
    const xml = `<conditionalFormatting sqref="C2:C3 C5:C6">` +
      `<cfRule type="dataBar" priority="1"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar>` +
      `<extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">` +
      `<x14:id>{6B6D6F3E-0F2B-4C4B-9E0C-6F7A0C9B1B11}</x14:id></ext></extLst></cfRule>` +
      `<cfRule type="cellIs" priority="2" operator="greaterThan" dxfId="0"><formula>5</formula></cfRule>` +
      `<cfRule type="cellIs" priority="3" operator="lessThan" dxfId="0"><formula>1</formula><extLst><ext uri="{other}"/></extLst></cfRule>` +
      `</conditionalFormatting>`;
    const rules = parseConditionalRules(xml, range as never, undefined);
    expect(rules.map((rule) => rule.linked ?? false)).toEqual([true, false, false]);
  });
});
