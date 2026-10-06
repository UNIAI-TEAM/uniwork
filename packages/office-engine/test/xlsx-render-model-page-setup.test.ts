// UNI-952: the worksheet page-layout reader the print copy is built from.
import { describe, expect, it } from "vitest";
import { parseWorksheetPageSetup } from "../src/xlsx/render-model-page-setup";

describe("parseWorksheetPageSetup", () => {
  it("reads orientation, paper, scale, fit, margins, print options and breaks", () => {
    const xml = `<worksheet>
      <sheetPr><tabColor rgb="FF00FF00"/><pageSetUpPr fitToPage="1"/></sheetPr>
      <sheetData/>
      <printOptions gridLines="1" headings="true" horizontalCentered="1"/>
      <pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
      <pageSetup paperSize="9" scale="85" fitToWidth="1" fitToHeight="0" orientation="landscape" r:id="rId1"/>
      <rowBreaks count="2" manualBreakCount="2"><brk id="40" max="16383" man="1"/><brk id="20" max="16383" man="1"/></rowBreaks>
      <colBreaks count="1"><brk id="5" max="1048575" man="1"/></colBreaks>
    </worksheet>`;
    expect(parseWorksheetPageSetup(xml)).toEqual({
      fitToPage: true,
      printGridlines: true,
      printHeadings: true,
      horizontalCentered: true,
      margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
      orientation: "landscape",
      paperSize: 9,
      scale: 85,
      fitToWidth: 1,
      fitToHeight: 0,
      rowBreaks: [20, 40],
      colBreaks: [5],
    });
  });

  it("is undefined when the sheet declares no page layout", () => {
    expect(parseWorksheetPageSetup("<worksheet><sheetData/></worksheet>")).toBeUndefined();
  });

  it("drops malformed values instead of guessing", () => {
    const xml = `<worksheet>
      <pageMargins left="x" right="0.7" top="0.75" bottom="0.75"/>
      <pageSetup paperSize="-3" scale="5" orientation="sideways" fitToWidth="nope"/>
      <rowBreaks><brk id="0"/><brk id="abc"/></rowBreaks>
    </worksheet>`;
    expect(parseWorksheetPageSetup(xml)).toBeUndefined();
  });

  it("reads odd and first-page header/footer text verbatim, entities decoded", () => {
    const xml = `<worksheet><sheetData/>
      <headerFooter differentFirst="1"><oddHeader>&amp;L&amp;A&amp;R&amp;D</oddHeader><oddFooter>&amp;CPage &amp;P of &amp;N &amp;&amp; more</oddFooter><firstFooter>&amp;C&amp;F &lt;draft&gt;</firstFooter><evenHeader>even</evenHeader></headerFooter>
    </worksheet>`;
    expect(parseWorksheetPageSetup(xml)).toEqual({
      headerFooter: {
        oddHeader: "&L&A&R&D",
        oddFooter: "&CPage &P of &N && more",
        firstFooter: "&C&F <draft>",
        differentFirst: true,
      },
    });
    expect(parseWorksheetPageSetup("<worksheet><headerFooter/></worksheet>")).toBeUndefined();
  });
});
