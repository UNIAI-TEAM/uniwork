// Fake PPTX fixtures — a deterministic JSON deck convention for tests.
//
// bytes = UTF-8 JSON {magic:"fake-pptx", deck:{size, slides, layouts},
//                     entries:{partPath: content}}
// openPptx decodes it; entries become archive.entries (a Map the asset
// oracle reads, including ppt/slides/_rels rels parts for media mapping).
import type { PptxElementLike, PptxParagraphLike, PptxSlideLike } from "../src/pptx";

const encoder = new TextEncoder();

export const FAKE_PPTX_MAGIC = "fake-pptx";

export interface FakePptxFixture {
  size?: { cx: number; cy: number };
  slides: Array<{
    id?: string;
    hidden?: boolean;
    elements: Array<Record<string, unknown>>;
  }>;
  layouts?: Array<{ name: string; path: string }>;
  entries?: Record<string, string>;
  /** Deck-level sections, mirroring the vendored SectionInfo[] (sections.ts:28). */
  sections?: Array<{ id: string; name: string; slideIndices: number[] }>;
}

export function para(text: string): PptxParagraphLike {
  return { runs: [{ text }] };
}

function textEl(id: string, text: string, offset = { x: 0, y: 0, cx: 914400, cy: 457200 }): PptxElementLike {
  return {
    id,
    type: "text",
    transform: { offset, rot: 0 },
    text: { paragraphs: [para(text)] },
  };
}

function picEl(id: string, offset = { x: 0, y: 0, cx: 914400, cy: 685800 }): PptxElementLike {
  return { id, type: "picture", transform: { offset, rot: 0 }, src: "ppt/media/image1.png" };
}

function shapeEl(id: string, offset = { x: 0, y: 0, cx: 914400, cy: 914400 }): PptxElementLike {
  return { id, type: "shape", transform: { offset, rot: 0 }, text: { paragraphs: [para("")] } };
}

function tableEl(id: string, offset = { x: 0, y: 0, cx: 1828800, cy: 914400 }): PptxElementLike {
  return { id, type: "table", transform: { offset, rot: 0 } };
}

function chartEl(id: string, offset = { x: 0, y: 0, cx: 1828800, cy: 914400 }): PptxElementLike {
  return { id, type: "chart", transform: { offset, rot: 0 } };
}

/** The standard kitchen-sink deck: two slides with text, picture, shape,
 * table and chart elements, one layout, and a package carrying media + rels
 * + an embedding so the asset oracle and warnings both have real surface.
 * The table/chart elements give the wave-A/B table and chart edits a real
 * target without changing any slide count. */
export function makeFakePptxBytes(extra?: Partial<FakePptxFixture>): Uint8Array {
  const fixture: FakePptxFixture = {
    size: { cx: 9144000, cy: 5143500 },
    slides: [
      { elements: [textEl("t1", "title slide"), picEl("p1"), shapeEl("s1"), tableEl("tbl1"), chartEl("chart1")] },
      { elements: [textEl("t2", "second slide"), shapeEl("s2"), tableEl("tbl2"), chartEl("chart2")] },
    ],
    layouts: [{ name: "Title Slide", path: "ppt/slideLayouts/slideLayout1.xml" }],
    entries: {
      "ppt/presentation.xml": "<p:presentation/>",
      "ppt/slides/slide1.xml": "<p:sld/>",
      "ppt/slides/slide2.xml": "<p:sld/>",
      "ppt/slides/_rels/slide1.xml.rels":
        '<R><Rel Id="rId1" Target="../media/image1.png"/><Rel Id="rId2" Target="../slideLayouts/slideLayout1.xml"/></R>',
      "ppt/media/image1.png": "PNG-FAKE-BYTES",
      "ppt/media/image2.svg": "<svg/>",
      "ppt/slideLayouts/slideLayout1.xml": "<p:sldLayout/>",
      "ppt/slideMasters/slideMaster1.xml": "<p:sldMaster/>",
      "ppt/embeddings/sheet1.xlsx": "XLSX-FAKE",
      "ppt/theme/theme1.xml": "<a:theme/>",
    },
    ...extra,
  };
  const payload = encoder.encode(JSON.stringify({ magic: FAKE_PPTX_MAGIC, ...fixture }));
  const out = new Uint8Array(4 + payload.length);
  out.set([0x50, 0x4b, 0x03, 0x04]); // PK zip magic — real OOXML is a zip
  out.set(payload, 4);
  return out;
}

export function makeNonOfficeBytes(): Uint8Array {
  return encoder.encode("this is plainly not an office package");
}

export function makeCorruptZipPptx(): Uint8Array {
  const head = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  const body = encoder.encode(JSON.stringify({ oops: true }));
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}

/** Fake encrypted bytes (CFB + EncryptedPackage marker) for the refusal path. */
export function makeEncryptedPptxBytes(plain: Uint8Array): Uint8Array {
  const head = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const name = "EncryptedPackage";
  const utf16 = new Uint8Array(name.length * 2);
  for (let i = 0; i < name.length; i++) {
    utf16[i * 2] = name.charCodeAt(i);
    utf16[i * 2 + 1] = 0;
  }
  const out = new Uint8Array(head.length + utf16.length + plain.length);
  out.set(head);
  out.set(utf16, head.length);
  out.set(plain, head.length + utf16.length);
  return out;
}
