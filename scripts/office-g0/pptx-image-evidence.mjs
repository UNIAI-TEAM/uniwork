// UNI-667 pptx IMAGE-on-disk evidence oracle (office-g0), r1.
//
// Independent byte oracle for one EXISTING slide picture whose backing media was replaced
// through the real renderer control. It reads the REAL saved/reopened package with the
// Node-builtin ZIP reader + strict XML tree parser from pptx-output-oracle.mjs, resolves the
// target picture's own <a:blip r:embed> through that slide part's OWN relationship file to a
// media part, and proves the replacement at the intended image identity.
//
// It never trusts an engine hash, a JSON response, or a caller-supplied expectation blob.
// Evidence is read from bytes only:
//   * the picture identity is the persisted (slide part, "pic", cNvPr id) triple, unique on
//     that slide;
//   * the credited media part's bytes must EQUAL the replacement PNG file byte for byte;
//   * the credited media part's DECODED pixels must equal the pinned replacement RGB pattern
//     (a bounded, self-contained PNG decoder: zlib inflate + all five scanline filters);
//   * the target's a:xfrm geometry must be unchanged from the authored fixture;
//   * the authored media part must no longer be referenced by the target;
//   * the author's CONTROL picture (a distinct second picture on the same slide) must keep its
//     own relationship AND its own media bytes, so a swap onto the wrong picture is caught;
//   * unrelated element text/tables/other slides must survive: the expected text rows and the
//     expected table are compared element by element, and every part named in
//     expected.preservedParts must be byte-equal. That part list must be DECLARED: an empty
//     list fails the named preservedPartsDeclared gate instead of passing vacuously.
//
// A malformed, ambiguous or unprovable input throws a named PptxImageError instead of
// returning a partial pass, and each rejection it makes has its own named code.
import { inflateSync } from "node:zlib";
import fs from "node:fs";
import {
  PptxOracleError,
  decodeXmlText,
  parseXml,
  readSlide,
  readSlideParts,
  readZipParts,
  requiredPart,
  sha256,
} from "./pptx-output-oracle.mjs";

export const IMAGE_ORACLE_ID = "office-g0-pptx-image-oracle-r1";
export const IMAGE_ORACLE_VERSION = 1;

// The authored fixture / replacement pins are OWNED BY THE RUN (run-pptx-cycle.mjs) and passed
// in through expected.fixtureSha256 + expected.replacement; this module never hard-codes a pin
// it has not itself read from bytes.

export class PptxImageError extends Error {
  constructor(code, detail) {
    super("[pptx-image-evidence] " + code + ": " + detail);
    this.name = "PptxImageError";
    this.code = code;
    this.detail = detail;
  }
}

const fail = (code, detail) => {
  throw new PptxImageError(code, detail);
};
const msgOf = (error) => String((error && error.message) || error);

/* --------------------------------------------------------------------- PNG ---- */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * Bounded, self-contained PNG reader: 8-bit, non-interlaced, colour types 0/2/4/6, all five
 * scanline filter algorithms. Anything outside that set fails by name - a decoded-pixel claim
 * is never made about an image this decoder did not actually decode.
 */
export function decodePngRgb(bytes, label = "<png>") {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) fail("not_a_png", label);
  let offset = 8;
  let header = null;
  const idat = [];
  let sawEnd = false;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("latin1");
    const start = offset + 8;
    if (start + length + 4 > buffer.length) fail("png_truncated_chunk", type + " in " + label);
    const data = buffer.subarray(start, start + length);
    if (type === "IHDR") {
      if (header) fail("png_duplicate_ihdr", label);
      if (length !== 13) fail("png_bad_ihdr", String(length));
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    offset = start + length + 4;
  }
  if (!header) fail("png_no_ihdr", label);
  if (!sawEnd) fail("png_no_iend", label);
  if (header.bitDepth !== 8) fail("png_bit_depth_unsupported", String(header.bitDepth));
  if (header.interlace !== 0) fail("png_interlaced_unsupported", label);
  if (header.compression !== 0) fail("png_compression_unsupported", String(header.compression));
  if (header.filter !== 0) fail("png_filter_method_unsupported", String(header.filter));
  const channels = CHANNELS_BY_COLOR_TYPE[header.colorType];
  if (!channels) fail("png_color_type_unsupported", String(header.colorType));
  if (idat.length === 0) fail("png_no_idat", label);

  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch (error) {
    fail("png_inflate_failed", label + ": " + msgOf(error));
  }
  const stride = header.width * channels;
  const expected = header.height * (stride + 1);
  if (raw.length !== expected) fail("png_scanline_size_mismatch", raw.length + " != " + expected);

  const rgb = Buffer.alloc(header.width * header.height * 3);
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? current[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) fail("png_filter_unsupported", String(filter) + " in " + label);
      current[i] = value & 0xff;
    }
    for (let x = 0; x < header.width; x++) {
      const source = x * channels;
      const target = (y * header.width + x) * 3;
      if (channels === 1) {
        rgb[target] = rgb[target + 1] = rgb[target + 2] = current[source];
      } else if (channels === 2) {
        rgb[target] = rgb[target + 1] = rgb[target + 2] = current[source];
      } else {
        rgb[target] = current[source];
        rgb[target + 1] = current[source + 1];
        rgb[target + 2] = current[source + 2];
      }
    }
    previous.set(current);
  }
  return {
    width: header.width,
    height: header.height,
    colorType: header.colorType,
    bitDepth: header.bitDepth,
    channels,
    bytes: buffer.length,
    sha256: sha256(buffer),
    rgbSha256: sha256(rgb),
    // The decoded RGB bytes themselves, so a caller can compare REAL rendered pixels
    // against a pinned pattern (the browser spec does this) instead of trusting a hash.
    rgb,
    pixel: { width: header.width, height: header.height, channels: 3, rgbSha256: sha256(rgb), byteLength: rgb.length },
  };
}

/* --------------------------------------------------------- slide relationship ---- */

function readRelationships(xml) {
  const relationships = new Map();
  for (const rel of parseXml(xml).children.flatMap(function walk(node) {
    const out = [];
    for (const child of node.children) {
      if (child.name === "Relationship" || child.name.endsWith(":Relationship")) out.push(child);
      out.push(...walk(child));
    }
    return out;
  })) {
    const { Id, Target, Type } = rel.attrs;
    if (!Id || !Target) fail("relationship_missing_fields", JSON.stringify(rel.attrs));
    if (relationships.has(Id)) fail("ambiguous_relationship_id", Id);
    relationships.set(Id, { target: Target, type: Type ?? "" });
  }
  return relationships;
}

function relsPathFor(partName) {
  const slash = partName.lastIndexOf("/");
  return partName.slice(0, slash) + "/_rels/" + partName.slice(slash + 1) + ".rels";
}

/** Package-relative target of a media relationship, rejecting external/escaping targets. */
function resolveTarget(baseDir, target) {
  if (/^[a-zA-Z]+:/.test(target)) fail("external_media_target", target);
  const segments = [];
  for (const segment of (target.startsWith("/") ? target.slice(1) : baseDir + "/" + target).split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) fail("media_target_escapes_package", target);
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

const localName = (name) => (name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name);
/** The value of a namespace-prefixed attribute by LOCAL name: r:embed / r:link (never r:id). */
const prefixedAttr = (node, local) => {
  for (const key of Object.keys(node.attrs)) if (key.includes(":") && localName(key) === local) return node.attrs[key];
  return undefined;
};

/** Every descendant with one local name, in document order. */
function descendants(node, local, out = []) {
  for (const child of node.children) {
    if (localName(child.name) === local) out.push(child);
    descendants(child, local, out);
  }
  return out;
}

function spTreeOf(parts, partName) {
  const root = parseXml(requiredPart(parts, partName).toString("utf8"));
  const sld = root.children.find((node) => localName(node.name) === "sld");
  if (!sld) fail("not_a_slide", partName);
  const cSld = descendants(sld, "cSld")[0] ?? null;
  const tree = cSld ? descendants(cSld, "spTree")[0] ?? null : null;
  if (!tree) fail("slide_missing_spTree", partName);
  return tree;
}

/**
 * The persisted picture records of one slide part. Each record carries its OWN blip r:embed,
 * the media part that relationship resolves to, and its a:xfrm geometry - never a whole-file
 * scan, never another slide's relationship map.
 */
export function readPictureRecords(parts, partName) {
  const tree = spTreeOf(parts, partName);
  const rels = readRelationships(requiredPart(parts, relsPathFor(partName)).toString("utf8"));
  const baseDir = partName.slice(0, partName.lastIndexOf("/"));
  return tree.children
    .filter((node) => localName(node.name) === "pic")
    .map((node) => {
      const cNvPr = descendants(node, "cNvPr")[0] ?? null;
      if (!cNvPr) fail("picture_missing_cNvPr", partName);
      const id = Number(cNvPr.attrs.id);
      if (!Number.isInteger(id)) fail("picture_bad_cNvPr_id", String(cNvPr.attrs.id));
      const blip = descendants(node, "blip")[0] ?? null;
      if (!blip) fail("picture_missing_blip", partName + "#" + id);
      const embed = prefixedAttr(blip, "embed") ?? null;
      const link = prefixedAttr(blip, "link") ?? null;
      const relationship = embed ? rels.get(embed) ?? null : null;
      if (embed && !relationship) fail("picture_embed_relationship_missing", partName + "#" + id + "@" + embed);
      const mediaPart = relationship ? resolveTarget(baseDir, relationship.target) : null;
      const xfrm = descendants(node, "xfrm")[0] ?? null;
      const off = xfrm ? descendants(xfrm, "off")[0] ?? null : null;
      const ext = xfrm ? descendants(xfrm, "ext")[0] ?? null : null;
      const geometry = off && ext
        ? { x: Number(off.attrs.x), y: Number(off.attrs.y), cx: Number(ext.attrs.cx), cy: Number(ext.attrs.cy) }
        : null;
      return {
        part: partName,
        kind: "pic",
        id,
        name: cNvPr.attrs.name ?? null,
        embed,
        link,
        mediaPart,
        mediaType: relationship ? relationship.type : null,
        geometry,
        identity: partName + "#pic#" + id,
      };
    });
}

const sameGeometry = (a, b) =>
  Boolean(a && b) &&
  ["x", "y", "cx", "cy"].every((key) => Number.isFinite(a[key]) && a[key] === b[key]);

const textOf = (element) => (element ? element.texts.join("") : null);

/* ------------------------------------------------------------------ assess ---- */

/**
 * The only input surface. Reads the real authored fixture, the real saved package and (through
 * readSavedBytes) a genuinely REOPENED copy, and returns an explicit evidence schema. Every
 * gate is a boolean over read bytes; a rejected claim carries a named code.
 */
export function assessPptxImageBytes(options) {
  if (!options || typeof options !== "object") fail("bad_input_api", "options object is required");
  const { fixtureBytes, savedBytes, expected } = options;
  if (!Buffer.isBuffer(fixtureBytes) || !Buffer.isBuffer(savedBytes)) {
    fail("bad_input_api", "fixtureBytes and savedBytes must be Buffers");
  }
  if (!expected || typeof expected !== "object") fail("bad_input_api", "expected is required");
  for (const key of ["target", "control", "replacement", "authored"]) {
    if (!expected[key] || typeof expected[key] !== "object") fail("bad_input_api", "expected." + key + " is required");
  }
  const target = expected.target;
  const control = expected.control;
  if (typeof target.part !== "string" || !Number.isInteger(Number(target.id))) {
    fail("bad_input_api", "expected.target must be {part, id}");
  }
  if (typeof control.part !== "string" || !Number.isInteger(Number(control.id))) {
    fail("bad_input_api", "expected.control must be {part, id}");
  }
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
  const fixtureShaMatchesExpected = expected.fixtureSha256 ? fixtureSha === expected.fixtureSha256 : null;
  if (expected.fixtureSha256 && !fixtureShaMatchesExpected) {
    fail("fixture_hash_mismatch", "authored fixture " + fixtureSha + " != pinned " + expected.fixtureSha256);
  }

  const fixtureSlides = readSlideParts(fixtureParts);
  const savedSlides = readSlideParts(savedParts);
  const expectedSlides = expected.slideParts ?? fixtureSlides;
  const slideOrderMatches = savedSlides.length === expectedSlides.length &&
    savedSlides.every((part, index) => part === expectedSlides[index]);

  const fixturePictures = readPictureRecords(fixtureParts, target.part);
  const savedPictures = readPictureRecords(savedParts, target.part);
  const pick = (records, id) => records.filter((record) => record.id === Number(id));
  const fixtureTargetMatches = pick(fixturePictures, target.id);
  const savedTargetMatches = pick(savedPictures, target.id);
  const fixtureControlMatches = pick(fixturePictures, control.id);
  const savedControlMatches = pick(savedPictures, control.id);
  const fixtureTarget = fixtureTargetMatches.length === 1 ? fixtureTargetMatches[0] : null;
  const savedTarget = savedTargetMatches.length === 1 ? savedTargetMatches[0] : null;
  const fixtureControl = fixtureControlMatches.length === 1 ? fixtureControlMatches[0] : null;
  const savedControl = savedControlMatches.length === 1 ? savedControlMatches[0] : null;

  if (fixtureTargetMatches.length !== 1) {
    fail("fixture_target_not_unique", "authored picture id " + target.id + " matched " + fixtureTargetMatches.length + " times");
  }
  if (fixtureControlMatches.length !== 1) {
    fail("fixture_control_not_unique", "authored control picture id " + control.id + " matched " + fixtureControlMatches.length + " times");
  }

  const mediaBytesOf = (parts, record) => {
    if (!record || !record.mediaPart) return null;
    return parts.get(record.mediaPart) ?? null;
  };

  const fixtureTargetMedia = mediaBytesOf(fixtureParts, fixtureTarget);
  const savedTargetMedia = mediaBytesOf(savedParts, savedTarget);
  const fixtureControlMedia = mediaBytesOf(fixtureParts, fixtureControl);
  const savedControlMedia = mediaBytesOf(savedParts, savedControl);

  const replacement = expected.replacement;
  const replacementFileBytes = options.replacementBytes ?? null;
  const replacementShaPin = typeof replacement.sha256 === "string" && /^[0-9a-f]{64}$/.test(replacement.sha256)
    ? replacement.sha256
    : null;
  const replacementFileShaMatches = replacementFileBytes && replacementShaPin
    ? sha256(replacementFileBytes) === replacementShaPin
    : null;

  // The authored fixture must NOT satisfy the replacement contract: the same validator that
  // credits the saved output is run against the authored bytes and must reject them by name.
  const authoredTargetMedia = fixtureTargetMedia;
  const authoredContract = authoredTargetMedia
    ? decodedContract(authoredTargetMedia, expected.authored.target, "authored target")
    : { ok: false, code: "authored_media_missing" };

  const savedContract = savedTargetMedia
    ? decodedContract(savedTargetMedia, replacement, "saved target")
    : { ok: false, code: "saved_media_missing" };

  const targetEmbedChanged = Boolean(fixtureTarget && savedTarget && fixtureTarget.embed !== savedTarget.embed);
  const targetMediaIsReplacement = Boolean(
    replacementFileBytes && savedTargetMedia && savedTargetMedia.equals(replacementFileBytes),
  );
  const targetMediaPreserved = Boolean(
    fixtureTargetMedia && savedTargetMedia && fixtureTargetMedia.equals(savedTargetMedia),
  );
  const authoredMediaStillReferencedByTarget = Boolean(
    fixtureTarget && savedTarget && fixtureTarget.mediaPart && fixtureTarget.mediaPart === savedTarget.mediaPart,
  );
  const controlMediaPreserved = Boolean(
    fixtureControlMedia && savedControlMedia && fixtureControlMedia.equals(savedControlMedia),
  );
  const controlEmbedPreserved = Boolean(fixtureControl && savedControl && fixtureControl.embed === savedControl.embed);
  const controlMediaUnchanged = controlMediaPreserved && controlEmbedPreserved;
  const targetGeometryPreserved = sameGeometry(fixtureTarget ? fixtureTarget.geometry : null, savedTarget ? savedTarget.geometry : null);

  const preservedParts = (expected.preservedParts ?? []).map((name) => {
    const before = fixtureParts.get(name) ?? null;
    const after = savedParts.get(name) ?? null;
    return { part: name, present: before !== null && after !== null, byteEqual: Boolean(before && after && before.equals(after)) };
  });
  const preserved = (expected.preserved ?? []).map((want) => {
    const part = want.part ?? target.part;
    const present = savedSlides.includes(part);
    const element = present
      ? readSlide(savedParts, part).elements.find((item) => item.kind === want.kind && item.id === Number(want.id)) ?? null
      : null;
    const text = textOf(element);
    return { part, kind: want.kind, id: Number(want.id), found: element !== null, text, matches: text === want.text };
  });
  // An unrelated TABLE is its own preservation claim: text rows alone would miss a deleted
  // graphicFrame, so the declared table is compared cell by cell when one is expected.
  const table = expected.table
    ? (() => {
        const part = expected.table.part ?? target.part;
        const present = savedSlides.includes(part);
        const frame = present
          ? readSlide(savedParts, part).elements.find((item) => item.kind === expected.table.kind && item.id === Number(expected.table.id)) ?? null
          : null;
        const cells = frame && frame.rows ? frame.rows.flat() : null;
        const wanted = expected.table.cells ?? [];
        return {
          part,
          kind: expected.table.kind,
          id: Number(expected.table.id),
          found: frame !== null,
          cells,
          matches: Boolean(cells && cells.length === wanted.length && cells.every((cell, index) => cell === wanted[index])),
        };
      })()
    : null;

  const gates = {
    fixtureShaMatchesExpected,
    savedDiffersFromFixture: !savedBytes.equals(fixtureBytes),
    savedStableAfterFreshReopen: reopenedSha === savedSha,
    fixtureUnchangedAfterRun: fixtureAfterSha === fixtureSha,
    slideOrderMatches,
    targetPictureUniqueOnSlide: savedTargetMatches.length === 1,
    controlPictureUniqueOnSlide: savedControlMatches.length === 1,
    targetEmbedChanged,
    targetMediaIsReplacementBytes: targetMediaIsReplacement,
    targetMediaDecodedMatchesReplacement: savedContract.ok === true,
    targetGeometryPreserved,
    authoredMediaNoLongerReferencedByTarget: !authoredMediaStillReferencedByTarget,
    targetMediaActuallyChanged: !targetMediaPreserved,
    controlPicturePreserved: controlMediaUnchanged,
    preservedTargetsMatch: preserved.length > 0 && preserved.every((entry) => entry.found && entry.matches),
    // A part-byte claim is only a claim if parts were actually named. `Array.prototype.every`
    // on an empty list is `true`, so an undeclared list would report a green preservation gate
    // having compared nothing; the length test makes the gate non-vacuous and
    // preservedPartsDeclared names the empty case explicitly.
    preservedPartsDeclared: preservedParts.length > 0,
    preservedPartsByteEqual: preservedParts.length > 0 && preservedParts.every((entry) => entry.present && entry.byteEqual),
    // null when no table was expected, so an undeclared table is not a silent green.
    tableContentMatches: table ? table.matches : null,
  };
  if (replacementFileShaMatches !== null) gates.replacementFileHashMatches = replacementFileShaMatches;

  // A `null` gate means "this claim was not made" (e.g. no table was declared, or no replacement
  // sha pin was supplied), so it is neither a pass nor a failure. Only an explicit false fails.
  const failed = Object.entries(gates).filter(([, value]) => value !== true && value !== null).map(([name]) => name);
  return {
    oracle: IMAGE_ORACLE_ID,
    version: IMAGE_ORACLE_VERSION,
    ok: failed.length === 0,
    failed,
    gates,
    expected: {
      target,
      control,
      replacement,
      authored: expected.authored,
      slideParts: expectedSlides,
      preservedParts: expected.preservedParts ?? [],
      preserved: expected.preserved ?? [],
      table: expected.table ?? null,
      fixtureSha256: expected.fixtureSha256 ?? null,
    },
    slides: { expected: expectedSlides, fixtureOrder: fixtureSlides, savedOrder: savedSlides, count: savedSlides.length },
    identity: {
      target: { part: target.part, kind: "pic", id: Number(target.id), identityString: target.part + "#pic#" + Number(target.id) },
      control: { part: control.part, kind: "pic", id: Number(control.id), identityString: control.part + "#pic#" + Number(control.id) },
      targetMatchCount: savedTargetMatches.length,
      controlMatchCount: savedControlMatches.length,
      ambiguous: savedTargetMatches.length > 1,
    },
    target: {
      found: savedTarget !== null,
      name: savedTarget ? savedTarget.name : null,
      identity: savedTarget ? savedTarget.identity : null,
      authoredEmbed: fixtureTarget ? fixtureTarget.embed : null,
      savedEmbed: savedTarget ? savedTarget.embed : null,
      authoredMediaPart: fixtureTarget ? fixtureTarget.mediaPart : null,
      savedMediaPart: savedTarget ? savedTarget.mediaPart : null,
      embedChanged: targetEmbedChanged,
      geometryAuthored: fixtureTarget ? fixtureTarget.geometry : null,
      geometrySaved: savedTarget ? savedTarget.geometry : null,
    },
    control: {
      found: savedControl !== null,
      identity: savedControl ? savedControl.identity : null,
      authoredEmbed: fixtureControl ? fixtureControl.embed : null,
      savedEmbed: savedControl ? savedControl.embed : null,
      authoredMediaPart: fixtureControl ? fixtureControl.mediaPart : null,
      savedMediaPart: savedControl ? savedControl.mediaPart : null,
      embedPreserved: controlEmbedPreserved,
      mediaPreserved: controlMediaPreserved,
    },
    media: {
      authoredTarget: describeMedia(fixtureTargetMedia, expected.authored.target),
      savedTarget: describeMedia(savedTargetMedia, replacement),
      authoredControl: describeMedia(fixtureControlMedia, expected.authored.control),
      savedControl: describeMedia(savedControlMedia, expected.authored.control),
    },
    preflight: {
      authoredTargetContract: authoredContract,
      savedTargetContract: savedContract,
      authoredFailsReplacementContract:
        authoredTargetMedia && replacementFileBytes
          ? !authoredTargetMedia.equals(replacementFileBytes) &&
            (authoredContract.ok !== true || authoredContract.rgbSha256 !== replacement.rgbSha256)
          : null,
    },
    preserved,
    preservedParts,
    table,
    fixture: { bytes: fixtureBytes.length, sha256: fixtureSha, sha256AfterRun: fixtureAfterSha },
    saved: { bytes: savedBytes.length, sha256: savedSha, sha256AfterFreshReopen: reopenedSha },
    reasons: failureReasons(gates),
  };
}

/** A named reason for every failed gate, so a rejection is never just a boolean. */
function failureReasons(gates) {
  const reasons = [];
  if (gates.savedDiffersFromFixture !== true) reasons.push({ code: "stale_output", gate: "savedDiffersFromFixture", detail: "the saved package still equals the authored fixture" });
  if (gates.targetEmbedChanged !== true) reasons.push({ code: "wrong_image_target", gate: "targetEmbedChanged", detail: "the target picture still points at its authored media relationship" });
  if (gates.targetMediaIsReplacementBytes !== true) reasons.push({ code: "replacement_bytes_mismatch", gate: "targetMediaIsReplacementBytes", detail: "the target media part is not the replacement PNG byte for byte" });
  if (gates.targetMediaDecodedMatchesReplacement !== true) reasons.push({ code: "replacement_content_mismatch", gate: "targetMediaDecodedMatchesReplacement", detail: "the target media pixels are not the pinned replacement pattern" });
  if (gates.targetMediaActuallyChanged !== true) reasons.push({ code: "replacement_no_op", gate: "targetMediaActuallyChanged", detail: "the target's media part is byte-identical to the authored one" });
  if (gates.authoredMediaNoLongerReferencedByTarget !== true) reasons.push({ code: "authored_media_still_referenced", gate: "authoredMediaNoLongerReferencedByTarget", detail: "the target still references the authored media part" });
  if (gates.targetGeometryPreserved !== true) reasons.push({ code: "geometry_not_preserved", gate: "targetGeometryPreserved", detail: "the target picture's a:xfrm changed" });
  if (gates.controlPicturePreserved !== true) reasons.push({ code: "lost_unrelated_object", gate: "controlPicturePreserved", detail: "the control picture on the same slide lost its relationship or its media bytes" });
  if (gates.preservedTargetsMatch !== true) reasons.push({ code: "lost_unrelated_object", gate: "preservedTargetsMatch", detail: "a preserved element's text no longer matches" });
  if (gates.tableContentMatches === false) reasons.push({ code: "lost_unrelated_object", gate: "tableContentMatches", detail: "the unrelated table's cells changed" });
  if (gates.preservedPartsDeclared !== true) reasons.push({ code: "preserved_parts_undeclared", gate: "preservedPartsDeclared", detail: "no preserved part was declared, so the byte-equality gate would have compared nothing" });
  if (gates.preservedPartsByteEqual !== true) reasons.push({ code: "lost_unrelated_part", gate: "preservedPartsByteEqual", detail: "a preserved part is no longer byte-equal" });
  if (gates.savedStableAfterFreshReopen !== true) reasons.push({ code: "reopen_drift", gate: "savedStableAfterFreshReopen", detail: "the reopened copy does not hash to the saved bytes" });
  if (gates.fixtureUnchangedAfterRun !== true) reasons.push({ code: "fixture_mutated", gate: "fixtureUnchangedAfterRun", detail: "the authored fixture changed during the run" });
  if (gates.slideOrderMatches !== true) reasons.push({ code: "slide_order_changed", gate: "slideOrderMatches", detail: "the saved deck's slide order differs from the authored one" });
  if (gates.targetPictureUniqueOnSlide !== true) reasons.push({ code: "wrong_image_target", gate: "targetPictureUniqueOnSlide", detail: "the target picture identity is not unique on its slide" });
  if (gates.fixtureShaMatchesExpected === false) reasons.push({ code: "fixture_hash_mismatch", gate: "fixtureShaMatchesExpected", detail: "the authored fixture is not the pinned one" });
  return reasons;
}

function decodedContract(mediaBytes, descriptor, label) {
  let png;
  try {
    png = decodePngRgb(mediaBytes, label);
  } catch (error) {
    return { ok: false, code: error instanceof PptxImageError ? error.code : "png_decode_failed", detail: msgOf(error) };
  }
  const dimensionsMatch = png.width === descriptor.width && png.height === descriptor.height;
  const rgbMatch = png.rgbSha256 === descriptor.rgbSha256;
  const code = !dimensionsMatch ? "dimensions_mismatch" : !rgbMatch ? "content_mismatch" : null;
  return {
    ok: code === null,
    code,
    width: png.width,
    height: png.height,
    channels: png.channels,
    colorType: png.colorType,
    bitDepth: png.bitDepth,
    bytes: png.bytes,
    sha256: png.sha256,
    rgbSha256: png.rgbSha256,
  };
}

function describeMedia(bytes, descriptor) {
  if (!bytes) return { present: false, bytes: 0, sha256: null, rgbSha256: null, rgbShaMatches: null };
  let png = null;
  try {
    png = decodePngRgb(bytes, "media");
  } catch {
    png = null;
  }
  return {
    present: true,
    bytes: bytes.length,
    sha256: sha256(bytes),
    width: png ? png.width : null,
    height: png ? png.height : null,
    rgbSha256: png ? png.rgbSha256 : null,
    rgbShaMatches: png && descriptor ? png.rgbSha256 === descriptor.rgbSha256 : null,
  };
}

/* ----------------------------------------------------------- browser wrapper ---- */

/**
 * Browser/oracle API wrapper. The browser calls this AFTER a genuine saved-file reopen with
 * reopenedPath = the path it observed in a fresh session-open. It enforces the pinned authored
 * fixture digest and throws on any unproven gate instead of returning a partial pass.
 */
export function verifyPptxImageOutput(input) {
  if (!input || typeof input !== "object") fail("bad_input_api", "input object is required");
  const { fixturePath, savedPath, reopenedPath, replacementPath } = input;
  for (const [name, value] of Object.entries({ fixturePath, savedPath, reopenedPath, replacementPath })) {
    if (typeof value !== "string" || value.length === 0) fail("bad_input_api", name + " must be a non-empty string");
  }
  const expected = input.expected ?? {};
  const report = assessPptxImageBytes({
    fixtureBytes: fs.readFileSync(fixturePath),
    savedBytes: fs.readFileSync(savedPath),
    replacementBytes: fs.readFileSync(replacementPath),
    readSavedBytes: () => fs.readFileSync(reopenedPath),
    readFixtureBytes: () => fs.readFileSync(fixturePath),
    expected,
  });
  if (!report.ok) {
    fail(
      "image_gate_failed",
      report.failed.join(", ") + " :: " + report.reasons.map((entry) => entry.code).join(", "),
    );
  }
  return {
    oracle: IMAGE_ORACLE_ID,
    version: IMAGE_ORACLE_VERSION,
    ok: true,
    fixturePath,
    savedPath,
    reopenedPath,
    replacementPath,
    fixtureSha256: report.fixture.sha256,
    savedSha256: report.saved.sha256,
    reopenedSha256: report.saved.sha256AfterFreshReopen,
    savedDiffersFromFixture: report.gates.savedDiffersFromFixture,
    reopenedStable: report.gates.savedStableAfterFreshReopen,
    identity: report.identity,
    target: report.target,
    control: report.control,
    media: report.media,
    preflight: report.preflight,
    preserved: report.preserved,
    preservedParts: report.preservedParts,
    table: report.table,
    gates: report.gates,
  };
}

/**
 * The authored fixture must FAIL the replacement contract; used as the negative preflight.
 * Returns the whole preflight rather than only the authored contract, because the reason this
 * helper exists is the NEGATIVE flag: a caller must be able to read
 * `authoredFailsReplacementContract` from it instead of re-deriving it. That flag stays null
 * unless real replacement bytes are supplied, so it is a comparison and never a free true.
 */
export function authoredImageEvidence(fixturePath, expected, replacementBytes = null) {
  const report = assessPptxImageBytes({
    fixtureBytes: fs.readFileSync(fixturePath),
    savedBytes: fs.readFileSync(fixturePath),
    replacementBytes,
    expected: { ...expected, preservedParts: [], preserved: [] },
  });
  return report.preflight;
}

export { PptxOracleError, decodeXmlText, readSlide, readSlideParts, readZipParts, requiredPart, sha256 };
