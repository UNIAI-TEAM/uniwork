// UNI-952 D4: header/footer pictures (&G) reach the render model through the
// gateway's optional readEntriesBase64 (lane L2). The package is a map of part
// texts behind a stub engine; media come from a fake base64 reader.
import { describe, expect, it } from "vitest";
import { readXlsxRenderModel, type XlsxGatewayFunctions } from "../src/xlsx";
import { HF_PICTURES_MAX_TOTAL_BYTES, HF_PICTURE_MAX_BYTES } from "../src/xlsx/render-model-hf-pictures";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const WORKBOOK = `<workbook ${NS}><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Plain" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const WORKBOOK_RELS = `<Relationships><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;
const SHEET_HF = `<worksheet ${NS}><sheetData/><headerFooter><oddHeader>&amp;L&amp;G</oddHeader><oddFooter>&amp;C&amp;G</oddFooter></headerFooter><legacyDrawingHF r:id="rId9"/></worksheet>`;
const SHEET_PLAIN = `<worksheet ${NS}><sheetData/><headerFooter><oddHeader>&amp;CPlain</oddHeader></headerFooter></worksheet>`;
const SHEET_RELS = `<Relationships><Relationship Id="rId9" Type="${REL}/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>`;
const vmlShape = (id: string, relId: string, style = "width:96pt;height:48pt"): string =>
  `<v:shape id="${id}" type="#_x0000_t75" style='position:absolute;${style}'><v:imagedata o:relid="${relId}" o:title="logo"/></v:shape>`;
const VML = `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">${vmlShape("LH", "rId1")}${vmlShape("CF", "rId2", "width:1in;height:0.5in")}</xml>`;
const VML_RELS = `<Relationships><Relationship Id="rId1" Type="${REL}/image" Target="../media/image1.png"/><Relationship Id="rId2" Type="${REL}/image" Target="../media/image2.jpeg"/></Relationships>`;

const PARTS: Record<string, string> = {
  "xl/workbook.xml": WORKBOOK,
  "xl/_rels/workbook.xml.rels": WORKBOOK_RELS,
  "xl/worksheets/sheet1.xml": SHEET_HF,
  "xl/worksheets/sheet2.xml": SHEET_PLAIN,
  "xl/worksheets/_rels/sheet1.xml.rels": SHEET_RELS,
  "xl/drawings/vmlDrawing1.vml": VML,
  "xl/drawings/_rels/vmlDrawing1.vml.rels": VML_RELS,
};

type ReadBase64 = (bytes: Uint8Array, paths: readonly string[], maxBytes: number, maxTotalBytes: number) => Promise<Record<string, string | null>>;

function engineWith(parts: Record<string, string>, readEntriesBase64?: ReadBase64): XlsxGatewayFunctions {
  return {
    async readWorkbook() {
      return { sheetNamesById: { "sheet-1": "Data", "sheet-2": "Plain" }, snapshot: { revision: 1, sheets: [] } };
    },
    async readEntriesText(_bytes: Uint8Array, paths: readonly string[]) {
      return Object.fromEntries(paths.map((path) => [path, parts[path] ?? null]));
    },
    ...(readEntriesBase64 ? { readEntriesBase64 } : {}),
  } as unknown as XlsxGatewayFunctions;
}

const read = (engine: XlsxGatewayFunctions) => readXlsxRenderModel(engine, new Uint8Array());
const pictures = async (engine: XlsxGatewayFunctions) => (await read(engine)).sheets[0]?.pageSetup?.headerFooter?.pictures;

describe("xlsx render model: header/footer pictures (&G)", () => {
  it("reads each VML shape's picture as a data: URL with its declared size (points)", async () => {
    const calls: { paths: readonly string[]; maxBytes: number; maxTotalBytes: number }[] = [];
    const engine = engineWith(PARTS, async (_bytes, paths, maxBytes, maxTotalBytes) => {
      calls.push({ paths, maxBytes, maxTotalBytes });
      return { "xl/media/image1.png": "iVBORw0KGgo=", "xl/media/image2.jpeg": "/9j/4AAQ" };
    });
    expect(await pictures(engine)).toEqual({
      LH: { dataUrl: "data:image/png;base64,iVBORw0KGgo=", widthPt: 96, heightPt: 48 },
      CF: { dataUrl: "data:image/jpeg;base64,/9j/4AAQ", widthPt: 72, heightPt: 36 },
    });
    expect(calls).toEqual([{ paths: ["xl/media/image1.png", "xl/media/image2.jpeg"], maxBytes: HF_PICTURE_MAX_BYTES, maxTotalBytes: HF_PICTURES_MAX_TOTAL_BYTES }]);
  });

  it("gives a sheet without a header/footer drawing no pictures", async () => {
    const engine = engineWith(PARTS, async () => ({}));
    expect((await read(engine)).sheets[1]?.pageSetup?.headerFooter?.pictures).toBeUndefined();
  });

  it("types every picture as no_reader when the gateway cannot read binary parts", async () => {
    expect(await pictures(engineWith(PARTS))).toEqual({ LH: { skipped: "no_reader" }, CF: { skipped: "no_reader" } });
  });

  it("skips a picture the reader refuses (over the cap or absent) and a type that cannot print", async () => {
    const parts = {
      ...PARTS,
      "xl/drawings/_rels/vmlDrawing1.vml.rels": VML_RELS.replace("image2.jpeg", "image2.emf"),
    };
    const engine = engineWith(parts, async () => ({ "xl/media/image1.png": null }));
    expect(await pictures(engine)).toEqual({ LH: { skipped: "unread" }, CF: { skipped: "unsupported_type" } });
  });

  it("skips a shape that names no media and rejects a payload that is not base64", async () => {
    const parts = { ...PARTS, "xl/drawings/vmlDrawing1.vml": `<xml>${vmlShape("LH", "rId1")}<v:shape id="RH"><v:imagedata/></v:shape></xml>` };
    const engine = engineWith(parts, async () => ({ "xl/media/image1.png": "AA\"onload=x" }));
    expect(await pictures(engine)).toEqual({ LH: { skipped: "unread" }, RH: { skipped: "missing" } });
  });

  it("hands the reader the per-picture cap and the whole workbook budget", async () => {
    const budgets: number[] = [];
    const engine = engineWith(PARTS, async (_bytes, _paths, _max, total) => {
      budgets.push(total);
      return { "xl/media/image1.png": "A".repeat(4000), "xl/media/image2.jpeg": null };
    });
    await read(engine);
    expect(budgets).toEqual([HF_PICTURES_MAX_TOTAL_BYTES]);
  });

  it("never fails the model when a picture part cannot be read", async () => {
    const engine = engineWith(PARTS, async () => { throw new Error("gateway gone"); });
    const model = await read(engine);
    expect(model.sheets[0]?.pageSetup?.headerFooter?.oddHeader).toBe("&L&G");
    expect(model.sheets[0]?.pageSetup?.headerFooter?.pictures).toBeUndefined();
  });
});
