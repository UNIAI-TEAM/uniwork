// styles.xml / theme XML parsing for the render model.
import { describe, expect, it } from "vitest";
import { parseColorXml, parseStylesXml, parseThemeXml, resolvedColor } from "../src/xlsx/render-model-styles";

describe("parseColorXml", () => {
  it("reads rgb (dropping alpha), theme with tint and indexed colours", () => {
    expect(parseColorXml('<color rgb="FF336699"/>')).toEqual({ rgb: "#336699" });
    expect(parseColorXml('<color rgb="aabbcc"/>')).toEqual({ rgb: "#AABBCC" });
    expect(parseColorXml('<color theme="4" tint="-0.25"/>')).toEqual({ theme: 4, tint: -0.25 });
    expect(parseColorXml('<color theme="1"/>')).toEqual({ theme: 1, tint: undefined });
    expect(parseColorXml('<color indexed="2"/>')).toEqual({ rgb: "#FF0000" });
    expect(parseColorXml('<color indexed="22"/>')).toEqual({ rgb: "#C0C0C0" });
  });

  it("returns undefined for nothing, an out-of-palette index, bad rgb or no attribute", () => {
    expect(parseColorXml(undefined)).toBeUndefined();
    expect(parseColorXml("")).toBeUndefined();
    expect(parseColorXml('<color indexed="99"/>')).toBeUndefined();
    expect(parseColorXml('<color rgb="zzz"/>')).toBeUndefined();
    expect(parseColorXml('<color auto="1"/>')).toBeUndefined();
    expect(parseColorXml('<color theme="x"/>')).toBeUndefined();
  });
});

describe("resolvedColor", () => {
  const palette = ["#FFFFFF", "#000000", "#808080"];

  it("passes rgb through and resolves theme slots against the palette, applying tint", () => {
    expect(resolvedColor(undefined, palette)).toEqual({});
    expect(resolvedColor({ rgb: "#123456" }, palette)).toEqual({ rgb: "#123456" });
    expect(resolvedColor({ theme: 0 }, palette)).toEqual({ rgb: "#FFFFFF", theme: 0 });
    expect(resolvedColor({ theme: 2, tint: -0.5 }, palette)).toEqual({ rgb: "#404040", theme: 2, tint: -0.5 });
    expect(resolvedColor({ theme: 1, tint: 0.5 }, palette)).toEqual({ rgb: "#808080", theme: 1, tint: 0.5 });
  });

  it("falls back to the first palette slot, then black, and to nothing without a palette", () => {
    expect(resolvedColor({ theme: 9 }, palette)).toEqual({ rgb: "#FFFFFF", theme: 9 });
    expect(resolvedColor({ theme: 9 }, [])).toEqual({ rgb: "#000000", theme: 9 });
    expect(resolvedColor({ theme: 1 }, undefined)).toEqual({});
  });

  it("tints coloured slots by luminance only", () => {
    expect(resolvedColor({ theme: 0, tint: 0.4 }, ["#FF0000"]).rgb).toBe("#FF6666");
    expect(resolvedColor({ theme: 0, tint: -0.5 }, ["#00FF00"]).rgb).toBe("#008000");
    expect(resolvedColor({ theme: 0, tint: 0.5 }, ["#0000FF"]).rgb).toBe("#8080FF");
  });
});

const STYLES = `<styleSheet>
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0&quot; kg&quot;"/><numFmt numFmtId="x" formatCode="bad"/></numFmts>
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/><scheme val="minor"/></font>
<font><b/><i/><strike/><u/><sz val="14"/><color rgb="FFFF0000"/><name val="Arial &amp; Co"/></font>
<font><b val="0"/><i val="0"/><strike val="0"/><u val="none"/><color theme="4" tint="0.4"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor theme="4" tint="-0.25"/></patternFill></fill>
<fill><gradientFill><stop position="0"><color rgb="FF00FF00"/></stop><stop position="1"><color rgb="FF000000"/></stop></gradientFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border diagonalUp="1" diagonalDown="true"><left style="thin"><color indexed="2"/></left><right style="thick"/><top style="dashed"><color rgb="FF0000FF"/></top><bottom/><diagonal style="hair"/></border>
</borders>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
<xf numFmtId="164" fontId="1" fillId="2" borderId="1"><alignment horizontal="center" vertical="top" wrapText="1" shrinkToFit="1" indent="2" textRotation="90"/></xf>
<xf numFmtId="14" fontId="2" fillId="3" borderId="0"><alignment wrapText="true"/></xf>
<xf numFmtId="49" fontId="0" fillId="4" borderId="0"/>
<xf numFmtId="999" fontId="9" fillId="9" borderId="9"/>
</cellXfs>
<dxfs count="2">
<dxf><font><b/><color rgb="FF00FF00"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill><border><top style="thin"><color rgb="FF111111"/></top></border><numFmt numFmtId="1" formatCode="0.00&quot;x&quot;"/></dxf>
<dxf/>
</dxfs>
</styleSheet>`;

describe("parseStylesXml", () => {
  const palette = ["#FFFFFF", "#000000", "#EEEEEE", "#111111", "#4472C4"];
  const parsed = parseStylesXml(STYLES, palette);

  it("reports the normal font and one style per cellXf", () => {
    expect(parsed.normalFontName).toBe("Calibri");
    expect(parsed.styles).toHaveLength(5);
  });

  it("builds the default xf from font 0 with the General format and no fill or border", () => {
    expect(parsed.styles[0]).toMatchObject({
      fontFamily: "Calibri",
      fontSize: 11,
      fontScheme: "minor",
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      wrapText: false,
      numberFormat: "General",
      diagonalUp: false,
      diagonalDown: false,
    });
    expect(parsed.styles[0]).not.toHaveProperty("fillColor");
    expect(parsed.styles[0]).not.toHaveProperty("borderTop");
  });

  it("combines font, solid fill, custom numFmt, alignment and borders of a styled xf", () => {
    const s = parsed.styles[1]!;
    expect(s).toMatchObject({
      fontFamily: "Arial & Co",
      fontSize: 14,
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      fontColor: "#FF0000",
      fillColor: "#FFFF00",
      numberFormat: '0.0" kg"',
      horizontalAlignment: "center",
      verticalAlignment: "top",
      wrapText: true,
      shrinkToFit: true,
      indent: 2,
      textRotation: 90,
      diagonalUp: true,
      diagonalDown: true,
      borderLeft: { style: "thin", color: "#FF0000" },
      borderRight: { style: "thick" },
      borderTop: { style: "dashed", color: "#0000FF" },
      borderDiagonal: { style: "hair" },
    });
    expect(s).not.toHaveProperty("borderBottom");
  });

  it("honours val=0 on font flags, resolves theme colours with tint and uses built-in formats", () => {
    const s = parsed.styles[2]!;
    expect(s).toMatchObject({ bold: false, italic: false, underline: false, strikethrough: false, wrapText: true, numberFormat: "m/d/yy" });
    expect(s).toMatchObject({ fontColorTheme: 4, fontColorTint: 0.4, fillColorTheme: 4, fillColorTint: -0.25 });
    expect(s.fontColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(s.fillColor).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("approximates a gradient fill with its first stop and keeps text format 49", () => {
    expect(parsed.styles[3]).toMatchObject({ fillColor: "#00FF00", numberFormat: "@" });
  });

  it("copes with ids that point at nothing", () => {
    const s = parsed.styles[4]!;
    expect(s).toMatchObject({ bold: false, wrapText: false, diagonalUp: false });
    expect(s).not.toHaveProperty("numberFormat");
    expect(s).not.toHaveProperty("fontFamily");
  });

  it("reads differential formats: inline font, bgColor fill, border and numFmt", () => {
    expect(parsed.dxfStyles).toHaveLength(2);
    expect(parsed.dxfStyles[0]).toMatchObject({
      bold: true,
      fontColor: "#00FF00",
      fillColor: "#FFC7CE",
      borderTop: { style: "thin", color: "#111111" },
      numberFormat: '0.00"x"',
    });
    expect(parsed.dxfStyles[1]).toMatchObject({ bold: false, wrapText: false });
  });

  it("returns empty collections for a stylesheet without sections", () => {
    expect(parseStylesXml("<styleSheet/>", undefined)).toEqual({ styles: [], dxfStyles: [] });
  });
});

describe("parseThemeXml", () => {
  const slot = (name: string, hex: string): string => `<a:${name}><a:srgbClr val="${hex}"/></a:${name}>`;
  const THEME = `<a:theme><a:themeElements><a:clrScheme name="x">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
${slot("dk2", "44546a")}${slot("lt2", "E7E6E6")}${slot("accent1", "4472C4")}${slot("accent2", "ED7D31")}
${slot("accent3", "A5A5A5")}${slot("accent4", "FFC000")}${slot("accent5", "5B9BD5")}${slot("accent6", "70AD47")}
${slot("hlink", "0563C1")}<a:folHlink><a:srgbClr val="nothex"/></a:folHlink>
</a:clrScheme><a:fontScheme><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="MS Gothic"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

  it("orders the colours as the OOXML theme indexes and reads the fonts", () => {
    expect(parseThemeXml(THEME)).toEqual({
      colors: ["#FFFFFF", "#000000", "#E7E6E6", "#44546A", "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47", "#0563C1", "#000000"],
      majorFont: "Calibri Light",
      minorFont: "Calibri",
      minorEa: "MS Gothic",
    });
  });

  it("returns undefined without a colour scheme and omits missing fonts", () => {
    expect(parseThemeXml("<a:theme/>")).toBeUndefined();
    const bare = parseThemeXml('<a:clrScheme><a:dk1><a:srgbClr val="010203"/></a:dk1></a:clrScheme><a:minorFont><a:ea typeface=""/></a:minorFont>');
    expect(bare?.colors[1]).toBe("#010203");
    expect(bare?.colors[0]).toBe("#000000");
    expect(bare).not.toHaveProperty("majorFont");
    expect(bare).not.toHaveProperty("minorEa");
  });
});
