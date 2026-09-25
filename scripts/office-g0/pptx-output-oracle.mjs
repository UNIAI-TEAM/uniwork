// UNI-667 pptx persisted-file output oracle. Scoped to lab/fixtures/g0-slides.pptx.
// Independent byte oracle: Node-builtins ZIP reader + strict XML tree parser over the
// REAL saved bytes. It never trusts an engine-reported hash or JSON.stringify of a
// response. Malformed / empty / truncated / ambiguous input throws instead of
// inventing a pass. Persisted identity is slide part + element kind + cNvPr id.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { inflateRawSync } from "node:zlib";

export const ORACLE_ID = "office-g0-pptx-oracle-r1";
export const ORACLE_VERSION = 1;
// options.expected contract (all optional, merged over DEFAULT_EXPECTED):
//   marker: string                       text that must appear under the target element
//   target: {part, kind, id}             persisted identity, exactly one match
//   slideParts: string[]                 ordered resolved slide parts
//   preservedParts: string[]             optional stricter parts byte-identical check
//   preserved: {part, kind, id, text}[]  elements whose joined text must match
//   table: {part, kind, id, cells[]}     graphicFrame table cells in row order
//   fixtureSha256: string                immutable authored fixture digest
export const DEFAULT_EXPECTED = Object.freeze({
  marker: "edited-by-lab",
  target: { part: "ppt/slides/slide1.xml", kind: "sp", id: 3 },
  slideParts: ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"],
  // Empty by default: an engine save may legitimately reserialise an untouched
  // part, so byte-equality is opt-in. Content preservation is enforced by the
  // element-level `preserved` targets below, not by whole-part byte equality.
  preservedParts: [],
  preserved: [
    { part: "ppt/slides/slide1.xml", kind: "sp", id: 2, text: "DOC-003 slide title" },
    { part: "ppt/slides/slide2.xml", kind: "sp", id: 2, text: "Second slide" },
  ],
  table: {
    part: "ppt/slides/slide1.xml", kind: "graphicFrame", id: 2,
    cells: ["Feature", "Value", "formula", "=SUM(A1:A2)", "unicode", "Ti\u1ebfng Vi\u1ec7t \u2014 \u65e5\u672c\u8a9e"],
  },
  fixtureSha256: "4f85bdd59277a70bc94a66ebd39dd4882f88b5edd4211c0d3de6d09b6763d935",
});

export class PptxOracleError extends Error {
  constructor(code, detail) {
    super("[pptx-output-oracle] " + code + ": " + detail);
    this.name = "PptxOracleError";
    this.code = code;
    this.detail = detail;
  }
}

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
// Strict decode: unknown named or out-of-range numeric entities throw, so no
// heuristic includes() can fake a marker match.
export function decodeXmlText(raw) {
  return String(raw).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) throw new PptxOracleError("unsupported_xml_entity", match);
      return String.fromCodePoint(code);
    }
    if (!(body in XML_ENTITIES)) throw new PptxOracleError("unsupported_xml_entity", match);
    return XML_ENTITIES[body];
  });
}

// Bounded ZIP reader (stored/deflated). Encryption, Zip64, truncation, size
// mismatch, unsupported methods and duplicate part names fail by name.
export function readZipParts(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new PptxOracleError("empty_input", "package bytes are empty");
  let eocd = -1;
  for (let i = Math.max(0, bytes.length - 22 - 0xffff); i <= bytes.length - 22; i += 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50) eocd = i;
  }
  if (eocd < 0) throw new PptxOracleError("missing_eocd", "no end-of-central-directory record");
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) {
    throw new PptxOracleError("zip64_unsupported", "Zip64 inspection is unsupported");
  }
  if (centralOffset + centralSize > bytes.length) throw new PptxOracleError("truncated_central_directory", "central directory past buffer");
  const parts = new Map();
  let cursor = centralOffset;
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new PptxOracleError("bad_central_entry", "entry " + entry);
    if (bytes.readUInt16LE(cursor + 8) & 0x1) throw new PptxOracleError("encrypted_entry", "entry " + entry);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (parts.has(name)) throw new PptxOracleError("ambiguous_zip_part", name);
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new PptxOracleError("bad_local_header", name);
    const dataOffset = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    if (dataOffset + compressedSize > bytes.length) throw new PptxOracleError("truncated_part", name);
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    const value = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (value === null) throw new PptxOracleError("unsupported_zip_method", method + " for " + name);
    if (value.length !== uncompressedSize) throw new PptxOracleError("part_size_mismatch", name);
    parts.set(name, value);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return parts;
}

export function requiredPart(parts, name) {
  const value = parts.get(name);
  if (!value) throw new PptxOracleError("missing_package_part", name);
  return value;
}

// Minimal, strict XML tree parser: declarations, comments, CDATA, self-closing and
// text nodes; unbalanced or unterminated markup throws.
export function parseXml(xml) {
  const root = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) { stack[stack.length - 1].text += xml.slice(i); break; }
    if (lt > i) stack[stack.length - 1].text += xml.slice(i, lt);
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt);
      if (end < 0) throw new PptxOracleError("malformed_xml", "unterminated comment");
      i = end + 3; continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt);
      if (end < 0) throw new PptxOracleError("malformed_xml", "unterminated CDATA");
      stack[stack.length - 1].text += xml.slice(lt + 9, end);
      i = end + 3; continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt);
      if (end < 0) throw new PptxOracleError("malformed_xml", "unterminated declaration");
      i = end + 2; continue;
    }
    if (xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt);
      if (end < 0) throw new PptxOracleError("malformed_xml", "unterminated doctype");
      i = end + 1; continue;
    }
    const gt = xml.indexOf(">", lt);
    if (gt < 0) throw new PptxOracleError("malformed_xml", "unterminated tag");
    const raw = xml.slice(lt + 1, gt);
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim();
      const node = stack.pop();
      if (!node || node.name !== name) throw new PptxOracleError("malformed_xml", "unbalanced close " + name);
      i = gt + 1; continue;
    }
    // Self-closing only when the trailing slash is markup, not part of a quoted
    // attribute value (e.g. a Target="x/" must not turn the element self-closing).
    const selfClosing = raw.replace(/="[^"]*"/g, '=""').endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const space = body.search(/\s/);
    const name = space < 0 ? body : body.slice(0, space);
    const attrs = {};
    if (space >= 0) {
      const attrRe = /([\w.:-]+)\s*=\s*"([^"]*)"/g;
      let match;
      while ((match = attrRe.exec(body.slice(space)))) {
        const key = match[1];
        const decoded = decodeXmlText(match[2]);
        if (key in attrs && attrs[key] !== decoded) throw new PptxOracleError("ambiguous_xml_attribute", key);
        attrs[key] = decoded;
      }
    }
    const node = { name, attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }
  if (stack.length !== 1) throw new PptxOracleError("malformed_xml", "unclosed element " + stack[stack.length - 1].name);
  return root;
}

const localName = (name) => (name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name);
const childrenNamed = (node, local) => node.children.filter((child) => localName(child.name) === local);
function descendants(node, local, out = []) {
  for (const child of node.children) {
    if (localName(child.name) === local) out.push(child);
    descendants(child, local, out);
  }
  return out;
}
const firstDescendant = (node, local) => descendants(node, local)[0] ?? null;
// Namespace-prefixed attribute (e.g. r:id): the plain "id" on p:sldId is the slide
// number, so it must never be mistaken for the relationship id.
function relAttr(node) {
  for (const key of Object.keys(node.attrs)) if (key.includes(":") && localName(key) === "id") return node.attrs[key];
  return undefined;
}
function readRelationships(xml) {
  const relationships = new Map();
  for (const rel of descendants(parseXml(xml), "Relationship")) {
    const { Id, Target } = rel.attrs;
    if (!Id || !Target) throw new PptxOracleError("relationship_missing_fields", JSON.stringify(rel.attrs));
    if (relationships.has(Id)) throw new PptxOracleError("ambiguous_relationship_id", Id);
    relationships.set(Id, { target: Target, type: rel.attrs.Type ?? "" });
  }
  return relationships;
}
function resolveTarget(baseDir, target) {
  if (/^[a-zA-Z]+:/.test(target)) throw new PptxOracleError("external_relationship_target", target);
  const segments = [];
  for (const part of (target.startsWith("/") ? target.slice(1) : baseDir + "/" + target).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!segments.length) throw new PptxOracleError("relationship_target_escapes_package", target);
      segments.pop(); continue;
    }
    segments.push(part);
  }
  return segments.join("/");
}

const SHAPE_KINDS = new Set(["sp", "graphicFrame", "pic", "cxnSp", "grpSp"]);
function elementRecord(partName, node) {
  const kind = localName(node.name);
  const cNvPr = firstDescendant(node, "cNvPr");
  if (!cNvPr) throw new PptxOracleError("shape_missing_cNvPr", partName + "#" + kind);
  const id = Number(cNvPr.attrs.id);
  if (!Number.isInteger(id)) throw new PptxOracleError("shape_bad_cNvPr_id", partName + "#" + kind + "@" + cNvPr.attrs.id);
  const texts = descendants(node, "t").map((t) => decodeXmlText(t.text));
  const tbl = firstDescendant(node, "tbl");
  const rows = tbl ? childrenNamed(tbl, "tr").map((tr) => childrenNamed(tr, "tc").map((tc) => descendants(tc, "t").map((t) => decodeXmlText(t.text)).join(""))) : null;
  return { part: partName, kind, id, name: cNvPr.attrs.name ?? null, texts, rows, identity: partName + "#" + kind + "#" + id };
}
// One slide part -> ordered shape records. Missing sld/spTree throws by name.
export function readSlide(parts, partName) {
  const root = parseXml(requiredPart(parts, partName).toString("utf8"));
  const sld = root.children.find((node) => localName(node.name) === "sld");
  if (!sld) throw new PptxOracleError("not_a_slide", partName);
  const cSld = firstDescendant(sld, "cSld");
  const tree = cSld ? firstDescendant(cSld, "spTree") : null;
  if (!tree) throw new PptxOracleError("slide_missing_spTree", partName);
  return { part: partName, elements: tree.children.filter((node) => SHAPE_KINDS.has(localName(node.name))).map((node) => elementRecord(partName, node)) };
}
// Ordered slide parts resolved through presentation.xml + its relationship (never ZIP
// order). Missing relationship, non-slide target or an empty deck throws.
export function readSlideParts(parts) {
  const root = parseXml(requiredPart(parts, "ppt/presentation.xml").toString("utf8"));
  const presentation = root.children.find((node) => localName(node.name) === "presentation");
  if (!presentation) throw new PptxOracleError("not_a_presentation", "ppt/presentation.xml");
  const list = firstDescendant(presentation, "sldIdLst");
  if (!list) throw new PptxOracleError("presentation_missing_sldIdLst", "ppt/presentation.xml");
  const relationships = readRelationships(requiredPart(parts, "ppt/_rels/presentation.xml.rels").toString("utf8"));
  const sldIds = childrenNamed(list, "sldId");
  if (sldIds.length === 0) throw new PptxOracleError("presentation_has_no_slides", "ppt/presentation.xml");
  return sldIds.map((sldId) => {
    const relId = relAttr(sldId);
    const relationship = relId ? relationships.get(relId) : null;
    if (!relationship) throw new PptxOracleError("missing_slide_relationship", String(relId));
    if (!/\/slide$/.test(relationship.type)) throw new PptxOracleError("relationship_is_not_slide", relId);
    const partName = resolveTarget("ppt", relationship.target);
    requiredPart(parts, partName);
    return partName;
  });
}

// The only input surface. Reads the real fixture and saved bytes, re-reads the saved
// file once more via readSavedBytes (an externally supplied reopened source, e.g. the
// file path observed in a fresh browser session-open), and returns an explicit
// evidence schema. bad_input_api and malformed packages throw, never a silent pass.
export function assessPptxBytes(options) {
  if (!options || typeof options !== "object") throw new PptxOracleError("bad_input_api", "options object is required");
  const expected = Object.assign({}, DEFAULT_EXPECTED, options.expected ?? {});
  const { fixtureBytes, savedBytes } = options;
  if (!Buffer.isBuffer(fixtureBytes) || !Buffer.isBuffer(savedBytes)) throw new PptxOracleError("bad_input_api", "fixtureBytes and savedBytes must be Buffers");
  const readSavedBytes = options.readSavedBytes ?? (() => savedBytes);
  const readFixtureBytes = options.readFixtureBytes ?? (() => fixtureBytes);
  const fixtureParts = readZipParts(fixtureBytes);
  const savedParts = readZipParts(savedBytes);
  requiredPart(fixtureParts, "[Content_Types].xml");
  requiredPart(savedParts, "[Content_Types].xml");

  const fixtureSha = sha256(fixtureBytes);
  const savedSha = sha256(savedBytes);
  const reopenedSha = sha256(readSavedBytes());
  const fixtureAfterSha = sha256(readFixtureBytes());

  const fixtureSlides = readSlideParts(fixtureParts);
  const savedSlides = readSlideParts(savedParts);
  const cache = new Map();
  const slideOf = (parts, part) => {
    const key = (parts === savedParts ? "saved:" : "fixture:") + part;
    if (!cache.has(key)) cache.set(key, readSlide(parts, part));
    return cache.get(key);
  };
  const present = (list, part) => list.includes(part);
  const find = (part, kind, id) => (present(savedSlides, part) ? slideOf(savedParts, part).elements.filter((element) => element.kind === kind && element.id === id) : []);

  const targetMatches = find(expected.target.part, expected.target.kind, expected.target.id);
  const target = targetMatches.length === 1 ? targetMatches[0] : null;
  const targetText = target ? target.texts.join("") : null;
  const targetMarkerPresent = Boolean(target && String(expected.marker).length > 0 && targetText.includes(expected.marker));

  const preserved = (expected.preserved ?? []).map((want) => {
    const element = find(want.part, want.kind, want.id)[0] ?? null;
    const text = element ? element.texts.join("") : null;
    return { part: want.part, kind: want.kind, id: want.id, found: element !== null, text, matches: text === want.text };
  });
  const table = expected.table
    ? (() => {
        const frame = find(expected.table.part, expected.table.kind, expected.table.id)[0] ?? null;
        const cells = frame && frame.rows ? frame.rows.flat() : null;
        const wanted = expected.table.cells;
        return { part: expected.table.part, kind: expected.table.kind, id: expected.table.id, found: frame !== null, cells, matches: Boolean(cells && cells.length === wanted.length && cells.every((cell, index) => cell === wanted[index])) };
      })()
    : null;
  const preservedParts = (expected.preservedParts ?? []).map((name) => {
    const before = fixtureParts.get(name) ?? null;
    const after = savedParts.get(name) ?? null;
    return { part: name, present: before !== null && after !== null, byteEqual: Boolean(before && after && before.equals(after)) };
  });

  const gates = {
    fixtureShaMatchesExpected: expected.fixtureSha256 ? fixtureSha === expected.fixtureSha256 : null,
    savedDiffersFromFixture: !savedBytes.equals(fixtureBytes),
    savedStableAfterFreshReopen: reopenedSha === savedSha,
    fixtureUnchangedAfterRun: fixtureAfterSha === fixtureSha,
    slideOrderMatches: savedSlides.length === expected.slideParts.length && savedSlides.every((part, index) => part === expected.slideParts[index]),
    structureComplete: fixtureSlides.length > 0 && savedSlides.length > 0,
    targetSlideInOrder: present(savedSlides, expected.target.part),
    targetIdentityUnique: targetMatches.length === 1,
    targetMarkerPresent,
    preservedTargetsMatch: preserved.length > 0 && preserved.every((entry) => entry.found && entry.matches),
    tableContentMatches: table ? table.matches : null,
    preservedPartsByteEqual: preservedParts.every((entry) => entry.present && entry.byteEqual),
  };

  return {
    oracle: ORACLE_ID, version: ORACLE_VERSION,
    ok: Object.values(gates).every((value) => value === true),
    gates,
    expected: { marker: expected.marker, target: expected.target, slideParts: expected.slideParts, preservedParts: expected.preservedParts ?? [], preserved: expected.preserved ?? [], table: expected.table ?? null, fixtureSha256: expected.fixtureSha256 ?? null },
    slides: { expected: expected.slideParts, fixtureOrder: fixtureSlides, savedOrder: savedSlides, count: savedSlides.length },
    identity: { target: expected.target, identityString: expected.target.part + "#" + expected.target.kind + "#" + expected.target.id, matchCount: targetMatches.length, ambiguous: targetMatches.length > 1 },
    target: { found: target !== null, name: target ? target.name : null, identity: target ? target.identity : null, text: targetText, markerPresent: targetMarkerPresent },
    preserved, table, preservedParts,
    fixture: { bytes: fixtureBytes.length, sha256: fixtureSha, sha256AfterRun: fixtureAfterSha },
    saved: { bytes: savedBytes.length, sha256: savedSha, sha256AfterFreshReopen: reopenedSha, differsFromFixture: gates.savedDiffersFromFixture, stableAfterFreshReopen: gates.savedStableAfterFreshReopen },
  };
}

// File-level API (the only path-based input surface).
export function assessPptxFile({ fixturePath, savedPath, expected } = {}) {
  if (typeof fixturePath !== "string" || typeof savedPath !== "string") throw new PptxOracleError("bad_input_api", "fixturePath and savedPath must be strings");
  return assessPptxBytes({
    fixtureBytes: fs.readFileSync(fixturePath),
    savedBytes: fs.readFileSync(savedPath),
    expected,
    readSavedBytes: () => fs.readFileSync(savedPath),
    readFixtureBytes: () => fs.readFileSync(fixturePath),
  });
}

// Pinned authored fixture digest. The wrapper enforces this constant, never a
// caller-supplied expectation, so the immutable pin cannot be relaxed by input.
export const PINNED_FIXTURE_SHA256 = "4f85bdd59277a70bc94a66ebd39dd4882f88b5edd4211c0d3de6d09b6763d935";

// Browser/oracle API wrapper (parallel-wave2 contract). The browser calls this AFTER a
// genuine saved-file reopen with reopenedPath = the actual path it observed in a fresh
// session-open; rereading savedPath alone is not treated as proof of a fresh reopen.
// Reads all three real files, enforces the pinned fixture hash, maps the prefixed
// {slidePart, elementKind, cNvPrId} target to a persisted identity, and throws on any
// unproven gate instead of returning a partial pass.
export async function verifyPptxOutput(input) {
  if (!input || typeof input !== "object") throw new PptxOracleError("bad_input_api", "input object is required");
  const { fixturePath, savedPath, reopenedPath, expectedMarker } = input;
  for (const [name, value] of Object.entries({ fixturePath, savedPath, reopenedPath, expectedMarker })) {
    if (typeof value !== "string" || value.length === 0) throw new PptxOracleError("bad_input_api", name + " must be a non-empty string");
  }
  const wanted = input.target;
  if (!wanted || typeof wanted !== "object") throw new PptxOracleError("bad_input_api", "target must be {slidePart, elementKind, cNvPrId}");
  if (typeof wanted.slidePart !== "string" || wanted.slidePart.length === 0) throw new PptxOracleError("bad_input_api", "target.slidePart must be a non-empty string");
  if (typeof wanted.elementKind !== "string" || wanted.elementKind.length === 0) throw new PptxOracleError("bad_input_api", "target.elementKind must be a non-empty string");
  const id = Number(wanted.cNvPrId);
  if (!Number.isInteger(id)) throw new PptxOracleError("bad_input_api", "target.cNvPrId must be an integer, got " + wanted.cNvPrId);

  const report = assessPptxBytes({
    fixtureBytes: fs.readFileSync(fixturePath),
    savedBytes: fs.readFileSync(savedPath),
    readSavedBytes: () => fs.readFileSync(reopenedPath),
    readFixtureBytes: () => fs.readFileSync(fixturePath),
    expected: { marker: expectedMarker, target: { part: wanted.slidePart, kind: localName(wanted.elementKind), id }, fixtureSha256: PINNED_FIXTURE_SHA256 },
  });
  const failed = Object.entries(report.gates).filter(([, value]) => value !== true).map(([name]) => name);
  if (failed.length > 0) throw new PptxOracleError("gate_failed", failed.join(", "));
  return {
    oracle: ORACLE_ID, version: ORACLE_VERSION, ok: true,
    fixturePath, savedPath, reopenedPath,
    fixtureSha256: report.fixture.sha256,
    savedSha256: report.saved.sha256,
    reopenedSha256: report.saved.sha256AfterFreshReopen,
    savedDiffersFromFixture: report.saved.differsFromFixture,
    reopenedStable: report.saved.stableAfterFreshReopen,
    slides: report.slides, identity: report.identity, target: report.target,
    preserved: report.preserved, table: report.table, gates: report.gates,
  };
}
