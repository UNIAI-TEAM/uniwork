// UNI-667 deterministic PPTX IMAGE fixture builder (office-g0), r1.
//
// Builds a small, fully deterministic deck that CONTAINS an existing picture and builds it
// IN MEMORY first, validates the built bytes with the structural ZIP/XML readers, and only then
// writes. Existing identical bytes are reused; existing DIFFERENT bytes fail loudly. Creation is
// exclusive ("wx"), and every path is contained under the authorized workspace root.
//
// Determinism: every ZIP entry and every auto-created directory carries the pinned ZIP_DATE
// instead of the wall clock (JSZip stamps new Date() otherwise), compression comes from pinned
// ZIP_OPTS, and both PNGs are hand-encoded with a pinned zlib level, so a rerun is byte-identical.
//
// The deck is built to be preserved-and-proved, not merely valid:
//   slide1: Title (sp, cNvPr 2) + TARGET picture (pic, cNvPr 3, rId2 -> ./media/image1.png)
//           + CONTROL picture (pic, cNvPr 4, rId3 -> ./media/image2.png)
//           + table (graphicFrame, cNvPr 5)
//   slide2: Second slide (sp, cNvPr 2)
// Two DISTINCT pictures on one slide is what makes a wrong-target replacement detectable: the
// control picture's own relationship and its own media bytes must survive untouched.
//
// Run:
//   node scripts/office-g0/create-pptx-image-fixture.mjs --deps <dir with node_modules> \
//        --out <workspace-contained dir> [--workspace <root>] [--expected-sha256 <hex>] [--check-only]
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

export const FIXTURE_NAME = "g0-image-slides.pptx";
export const REPLACEMENT_NAME = "g0-image-slides-replacement.png";
export const AUTHORED_NAME = "g0-image-slides-authored.png";
export const TITLE_TEXT = "DOC-003 slide title";
export const SECOND_TEXT = "Second slide";
export const TABLE_CELLS = ["Feature", "Value", "formula", "=SUM(A1:A2)"];
export const TARGET = Object.freeze({ part: "ppt/slides/slide1.xml", kind: "pic", id: 3 });
export const CONTROL = Object.freeze({ part: "ppt/slides/slide1.xml", kind: "pic", id: 4 });
export const SLIDE_PARTS = Object.freeze(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"]);
/** The unrelated table that rides on slide 1; it must survive the picture replacement. */
export const TABLE = Object.freeze({
  part: "ppt/slides/slide1.xml",
  kind: "graphicFrame",
  id: 5,
  cells: Object.freeze([...TABLE_CELLS]),
});
/**
 * Package parts that a picture replacement must leave BYTE-IDENTICAL. The oracle refuses an
 * empty list (a named preservedPartsDeclared failure), so this list is the real preservation
 * claim rather than a vacuous `[].every(...)`. Deliberately absent: the target slide part and
 * its relationship file (the replacement rewrites the blip's r:embed and adds a relationship),
 * the authored media part the target no longer references, and the newly added replacement
 * media part. Every other part is invariant and is pinned here.
 */
export const PRESERVED_PARTS = Object.freeze([
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/core.xml",
  "ppt/_rels/presentation.xml.rels",
  "ppt/media/image2.png",
  "ppt/presentation.xml",
  "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
  "ppt/slideLayouts/slideLayout1.xml",
  "ppt/slideMasters/_rels/slideMaster1.xml.rels",
  "ppt/slideMasters/slideMaster1.xml",
  "ppt/slides/_rels/slide2.xml.rels",
  "ppt/slides/slide2.xml",
  "ppt/theme/theme1.xml",
]);
/** Authored picture frame, in EMU, shared by the target picture of both variants. */
export const TARGET_FRAME = Object.freeze({ x: 5029200, y: 731520, cx: 1828800, cy: 1371600 });
/** Replacement image pixel size; both PNGs are this size so the frame is what stays fixed. */
export const IMAGE_SIZE = 16;
const FIXED_DATE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
const ZIP_OPTS = { type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "DOS" };

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (code, message) => {
  const error = new Error("create-pptx-image-fixture: " + code + ": " + message);
  error.code = code;
  throw error;
};

/** Every output/scratch path must sit inside the authorized workspace root. */
export function assertContained(root, target, label) {
  const rel = relative(resolve(root), resolve(target));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    fail("path_outside_workspace", label + " escapes the authorized workspace root " + resolve(root) + ": " + resolve(target));
  }
  return resolve(target);
}

/** The CJS JSZip from an EXPLICIT dependency directory; never a guess, never an install. */
export function loadFixtureDeps(depsDir) {
  const root = resolve(depsDir ?? "");
  if (!existsSync(join(root, "package.json"))) fail("deps_dir_invalid", "no package.json in " + root);
  const require = createRequire(join(root, "package.json"));
  let entry;
  try {
    entry = require.resolve("jszip");
  } catch (error) {
    fail("jszip_unavailable", "jszip is not resolvable from " + root);
  }
  return { JSZip: require(entry) };
}

/* --------------------------------------------------------------------- PNG ---- */

function crc32(buffer) {
  let value = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    value ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

/**
 * Deterministic hand-encoded 8-bit RGB PNG (colour type 2, filter 0) whose pixels come from a
 * pure generator, so the DECODED RGB of the authored and replacement images is known by
 * construction on both the writing and the reading side. No canvas, no randomness.
 */
export function encodePng(size, pixel) {
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y += 1) {
    const row = y * (1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      const at = row + 1 + x * 3;
      const [r, g, b] = pixel(x, y);
      raw[at] = r & 0xff;
      raw[at + 1] = g & 0xff;
      raw[at + 2] = b & 0xff;
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Decoded RGB stride digest of a generator, so the pin is a property of the PIXELS. */
export function generatorRgbSha256(size, pixel) {
  const rgb = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x, y);
      const at = (y * size + x) * 3;
      rgb[at] = r & 0xff;
      rgb[at + 1] = g & 0xff;
      rgb[at + 2] = b & 0xff;
    }
  }
  return sha(rgb);
}

// Three visually and numerically distinct images. The authored/control images are gradients;
// the replacement is an inverted, differently-hued gradient so no accidental equality can pass.
export const AUTHORED_PIXEL = (x, y) => [(x * 16) & 0xff, (y * 16) & 0xff, 64];
export const CONTROL_PIXEL = (x, y) => [32, (x * 14) & 0xff, (y * 14) & 0xff];
export const REPLACEMENT_PIXEL = (x, y) => [255 - ((x * 12) & 0xff), 255 - ((y * 12) & 0xff), 200];

/* ------------------------------------------------------------------- OOXML ---- */

function pContentTypes() {
  return DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
    '<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';
}

const ROOT_RELS = DECL + '<Relationships xmlns="' + NS_PKG + '">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '</Relationships>';

const PRESENTATION = DECL + '<p:presentation xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '">' +
  '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
  '<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst>' +
  '<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>' +
  '<p:notesSz cx="6858000" cy="9144000"/></p:presentation>';

const PRESENTATION_RELS = DECL + '<Relationships xmlns="' + NS_PKG + '">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>' +
  '</Relationships>';

const SLIDE_LAYOUT = DECL + '<p:sldLayout xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '" type="blank" preserve="1">' +
  '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
  '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
  '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

const SLIDE_LAYOUT_RELS = DECL + '<Relationships xmlns="' + NS_PKG + '">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>' +
  '</Relationships>';

const SLIDE_MASTER = DECL + '<p:sldMaster xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '">' +
  '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
  '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
  '</p:spTree></p:cSld>' +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
  '<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>';

const SLIDE_MASTER_RELS = DECL + '<Relationships xmlns="' + NS_PKG + '">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>' +
  '</Relationships>';

const THEME = DECL + '<a:theme xmlns:a="' + NS_A + '" name="UniWork Office Fixture Theme">' +
  '<a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
  '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
  '<a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst>' +
  '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
  '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>' +
  '</a:themeElements></a:theme>';

const CORE = DECL + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  '<dc:title>UNI-667 PPTX image fixture</dc:title><dc:creator>UniWork office-g0</dc:creator>' +
  '<dcterms:created xsi:type="dcterms:W3CDTF">2026-09-16T00:00:00Z</dcterms:created>' +
  '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-16T00:00:00Z</dcterms:modified></cp:coreProperties>';

function textBody(text, size, bold) {
  return '<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="' + size + '"' +
    (bold ? ' b="1"' : "") + '/><a:t>' + text + '</a:t></a:r></a:p></p:txBody>';
}

function spShape(id, name, text, box, size, bold) {
  return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + name + '"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="' + box.x + '" y="' + box.y + '"/><a:ext cx="' + box.cx + '" cy="' + box.cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
    textBody(text, size, bold) + '</p:sp>';
}

/** One picture with its OWN relationship id and its OWN frame; both are asserted independently. */
function picShape(id, name, embedId, frame) {
  return '<p:pic><p:nvPicPr><p:cNvPr id="' + id + '" name="' + name + '"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="' + embedId + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    '<p:spPr><a:xfrm><a:off x="' + frame.x + '" y="' + frame.y + '"/><a:ext cx="' + frame.cx + '" cy="' + frame.cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
}

function tableShape(id, rows) {
  const gridCols = rows[0].map(() => '<a:gridCol w="3000000"/>').join("");
  const trs = rows.map((cells, r) => '<a:tr h="370840">' + cells.map((cell) =>
    '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1400"' + (r === 0 ? ' b="1"' : "") +
    '/><a:t>' + cell + '</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>').join("") + '</a:tr>').join("");
  return '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' + id + '" name="Fixture table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
    '<p:xfrm><a:off x="800000" y="3600000"/><a:ext cx="6000000" cy="800000"/></p:xfrm>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">' +
    '<a:tbl><a:tblPr firstRow="1"/><a:tblGrid>' + gridCols + '</a:tblGrid>' + trs + '</a:tbl>' +
    '</a:graphicData></a:graphic></p:graphicFrame>';
}

function slide(shapes) {
  return DECL + '<p:sld xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '">' +
    '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    shapes.join("") + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}

function slideRels(entries) {
  return DECL + '<Relationships xmlns="' + NS_PKG + '">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
    entries.map((entry, index) =>
      '<Relationship Id="rId' + (index + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' +
      entry + '"/>').join("") + '</Relationships>';
}

/* --------------------------------------------------------------------- ZIP ---- */

/**
 * Deterministic ZIP. Part order is explicit (first names in order, then the rest sorted by code
 * unit, with directory entries between), every file and every auto-created directory carries
 * ZIP_DATE, and no per-file date can leak the wall clock.
 */
export async function writeZip(JSZip, files, { first = [] } = {}) {
  const names = Object.keys(files);
  const firstNames = first.filter((name) => names.includes(name));
  const restNames = names.filter((name) => !first.includes(name)).sort();
  const dirs = new Set();
  for (const name of restNames) {
    const segments = name.split("/");
    for (let i = 1; i < segments.length; i += 1) dirs.add(segments.slice(0, i).join("/") + "/");
  }
  const zip = new JSZip();
  for (const name of firstNames) zip.file(name, files[name], { date: FIXED_DATE, createFolders: false });
  const sortedDirs = [...dirs].sort();
  for (const dir of sortedDirs) zip.folder(dir);
  for (const name of restNames) zip.file(name, files[name], { date: FIXED_DATE, createFolders: false });
  for (const dir of sortedDirs) zip.files[dir].date = FIXED_DATE;
  return zip.generateAsync(ZIP_OPTS);
}

export function authoredPng() {
  return encodePng(IMAGE_SIZE, AUTHORED_PIXEL);
}
export function controlPng() {
  return encodePng(IMAGE_SIZE, CONTROL_PIXEL);
}
export function replacementPng() {
  return encodePng(IMAGE_SIZE, REPLACEMENT_PIXEL);
}

/**
 * Pure in-memory build, used by the builder AND by the tests (real built bytes, no write). The
 * returned descriptor carries the authored/control/replacement descriptor pins so a caller can
 * assert the decoded-pixel contract without re-deriving the generators.
 */
export async function buildPptxImageFixture({ JSZip }) {
  const parts = {};
  parts["[Content_Types].xml"] = pContentTypes();
  parts["_rels/.rels"] = ROOT_RELS;
  parts["ppt/presentation.xml"] = PRESENTATION;
  parts["ppt/_rels/presentation.xml.rels"] = PRESENTATION_RELS;
  parts["ppt/slides/slide1.xml"] = slide([
    spShape(2, "Title 1", TITLE_TEXT, { x: 685800, y: 685800, cx: 7000000, cy: 800000 }, 2800, true),
    picShape(TARGET.id, "Target image", "rId2", TARGET_FRAME),
    picShape(CONTROL.id, "Control image", "rId3", { x: 7315200, y: 731520, cx: 1371600, cy: 1371600 }),
    tableShape(5, [TABLE_CELLS.slice(0, 2), TABLE_CELLS.slice(2, 4)]),
  ]);
  parts["ppt/slides/_rels/slide1.xml.rels"] = slideRels(["../media/image1.png", "../media/image2.png"]);
  parts["ppt/slides/slide2.xml"] = slide([
    spShape(2, "Title 2", SECOND_TEXT, { x: 685800, y: 685800, cx: 7000000, cy: 800000 }, 2400, true),
  ]);
  parts["ppt/slides/_rels/slide2.xml.rels"] = slideRels([]);
  parts["ppt/slideMasters/slideMaster1.xml"] = SLIDE_MASTER;
  parts["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = SLIDE_MASTER_RELS;
  parts["ppt/slideLayouts/slideLayout1.xml"] = SLIDE_LAYOUT;
  parts["ppt/slideLayouts/_rels/slideLayout1.xml.rels"] = SLIDE_LAYOUT_RELS;
  parts["ppt/theme/theme1.xml"] = THEME;
  parts["docProps/core.xml"] = CORE;
  parts["ppt/media/image1.png"] = authoredPng();
  parts["ppt/media/image2.png"] = controlPng();
  const fixtureBytes = await writeZip(JSZip, parts, { first: ["[Content_Types].xml"] });
  const replacementBytes = replacementPng();
  const authored = { width: IMAGE_SIZE, height: IMAGE_SIZE, rgbSha256: generatorRgbSha256(IMAGE_SIZE, AUTHORED_PIXEL), bytes: authoredPng().length, sha256: sha(authoredPng()) };
  const control = { width: IMAGE_SIZE, height: IMAGE_SIZE, rgbSha256: generatorRgbSha256(IMAGE_SIZE, CONTROL_PIXEL), bytes: controlPng().length, sha256: sha(controlPng()) };
  const replacement = { width: IMAGE_SIZE, height: IMAGE_SIZE, rgbSha256: generatorRgbSha256(IMAGE_SIZE, REPLACEMENT_PIXEL), bytes: replacementBytes.length, sha256: sha(replacementBytes) };
  if (authored.rgbSha256 === replacement.rgbSha256) fail("authored_equals_replacement", "authored and replacement pixels must differ");
  if (control.rgbSha256 === replacement.rgbSha256) fail("control_equals_replacement", "control and replacement pixels must differ");
  if (authored.rgbSha256 === control.rgbSha256) fail("authored_equals_control", "authored and control pixels must differ");
  if (replacementPng().equals(authoredPng())) fail("authored_equals_replacement_bytes", "authored and replacement PNG bytes must differ");
  return {
    fixtureBytes,
    replacementBytes,
    authoredPngBytes: authoredPng(),
    controlPngBytes: controlPng(),
    authored,
    control,
    replacement,
  };
}

/** Write-once policy: refuse to clobber differing existing bytes, reuse identical ones. */
export function resolveWriteOutcome(existingBytes, bytes, targetPath) {
  if (existingBytes) {
    if (existingBytes.equals(bytes)) return { path: targetPath, bytes: bytes.length, sha256: sha(bytes), reused: true, written: false };
    fail("existing_output_differs", "refusing to overwrite " + targetPath + " (existing " + sha(existingBytes) + " != new " + sha(bytes) + ")");
  }
  return { path: targetPath, bytes: bytes.length, sha256: sha(bytes), reused: false, written: true };
}

/** Plan every target before writing any of them; a plan observes NO I/O and never claims a write. */
export function planWrites(targets, { checkOnly = false } = {}) {
  return targets.map((target) => {
    const existing = existsSync(target.path) ? readFileSync(target.path) : null;
    const planned = resolveWriteOutcome(existing, target.bytes, target.path);
    return { outcome: { ...planned, written: false, wouldWrite: planned.written, checkOnly }, contents: target.bytes, checkOnly };
  });
}

export async function writeOutputs(targets, options = {}) {
  const plans = planWrites(targets, options);
  const created = [];
  try {
    for (const plan of plans) {
      if (!plan.outcome.wouldWrite || plan.checkOnly) continue;
      await mkdir(dirname(plan.outcome.path), { recursive: true });
      await writeFile(plan.outcome.path, plan.contents, { flag: "wx" });
      created.push(plan.outcome.path);
    }
  } catch (error) {
    for (const target of created) await rm(target, { force: true }).catch(() => undefined);
    throw error;
  }
  return plans.map((plan) => ({ ...plan.outcome, written: plan.checkOnly ? false : plan.outcome.wouldWrite }));
}

/** Expected contract object the image oracle consumes; one place, so spec and oracle cannot drift. */
export function fixtureExpectations(built, fixtureSha256) {
  return {
    target: { part: TARGET.part, kind: TARGET.kind, id: TARGET.id },
    control: { part: CONTROL.part, kind: CONTROL.kind, id: CONTROL.id },
    authored: { target: built.authored, control: built.control },
    replacement: built.replacement,
    slideParts: [...SLIDE_PARTS],
    preservedParts: [...PRESERVED_PARTS],
    table: { part: TABLE.part, kind: TABLE.kind, id: TABLE.id, cells: [...TABLE.cells] },
    preserved: [
      { part: "ppt/slides/slide1.xml", kind: "sp", id: 2, text: TITLE_TEXT },
      { part: "ppt/slides/slide2.xml", kind: "sp", id: 2, text: SECOND_TEXT },
    ],
    fixtureSha256: fixtureSha256 ?? null,
  };
}

const argOf = (args, name, fallback) => {
  const index = args.indexOf("--" + name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};

export async function main(argv = process.argv.slice(2), env = process.env) {
  const depsArg = argOf(argv, "deps", env.OFFICE_G0_PPTX_FIXTURE_DEPS ?? "");
  if (!depsArg) fail("deps_required", "--deps <dir containing node_modules> is required");
  const workspace = resolve(argOf(argv, "workspace", env.OFFICE_G0_WORKSPACE ?? process.cwd()));
  const outDir = assertContained(workspace, argOf(argv, "out", join(workspace, "lab", "fixtures")), "--out");
  const checkOnly = argv.includes("--check-only");
  const expectedFixture = (argOf(argv, "expected-sha256", "") ?? "").trim();
  const expectedReplacement = (argOf(argv, "expected-replacement-sha256", "") ?? "").trim();
  const { JSZip } = loadFixtureDeps(resolve(depsArg));
  const built = await buildPptxImageFixture({ JSZip });

  const fixtureSha = sha(built.fixtureBytes);
  const replacementSha = sha(built.replacementBytes);
  if (expectedFixture && expectedFixture !== fixtureSha) fail("fixture_hash_mismatch", "fixture " + fixtureSha + " != expected " + expectedFixture);
  if (expectedReplacement && expectedReplacement !== replacementSha) fail("replacement_hash_mismatch", "replacement " + replacementSha + " != expected " + expectedReplacement);

  const outputs = await writeOutputs(
    [
      { path: assertContained(workspace, join(outDir, FIXTURE_NAME), "fixture"), bytes: built.fixtureBytes },
      { path: assertContained(workspace, join(outDir, REPLACEMENT_NAME), "replacement"), bytes: built.replacementBytes },
      { path: assertContained(workspace, join(outDir, AUTHORED_NAME), "authored"), bytes: built.authoredPngBytes },
    ],
    { checkOnly },
  );
  const [fixture, replacement, authoredPngOut] = outputs;
  console.log(JSON.stringify({
    fixture: { ...fixture, name: FIXTURE_NAME },
    replacement: { ...replacement, name: REPLACEMENT_NAME, ...built.replacement },
    authoredPng: { ...authoredPngOut, name: AUTHORED_NAME, ...built.authored },
    control: built.control,
    deterministic: "JSZip dates pinned to 2026-01-01Z, DOS platform, DEFLATE level 9, hand-encoded PNGs at zlib level 9; a rerun must print the same hashes",
  }, null, 2));
  return { fixture, replacement, built, expectations: fixtureExpectations(built, fixtureSha) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(String((error && error.message) || error));
    process.exitCode = 1;
  });
}
