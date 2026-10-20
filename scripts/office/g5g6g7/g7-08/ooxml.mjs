// G7-08 (UNI-1385) pure OOXML (DOCX / PPTX) and PDF binary/XML helpers and oracles.
// Pure functions: no filesystem or network I/O; operates on Buffer/Uint8Array bytes passed in.

import { posix as pathPosix } from 'node:path';
import { inflateSync } from 'node:zlib';
import { readZipEntries, sha256Hex } from '../harness/fixture-files.mjs';

export const VERDICT = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED' });
export const ROW_EXIT = Object.freeze({ PASS: 0, FAIL: 1, BLOCKED: 77 });

export function passVerdict(reason, details = {}) {
  return { status: VERDICT.PASS, exitCode: ROW_EXIT.PASS, reason, details };
}

export function failVerdict(reason, details = {}) {
  return { status: VERDICT.FAIL, exitCode: ROW_EXIT.FAIL, reason, details };
}

export function blockedVerdict(reason, details = {}) {
  const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
  if (!cleanReason) return failVerdict('blocked_without_named_reason', details);
  return { status: VERDICT.BLOCKED, exitCode: ROW_EXIT.BLOCKED, reason: cleanReason, details };
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decodeXml = (text) =>
  String(text ?? '').replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (all, ent) => {
    if (ent.startsWith('#x') || ent.startsWith('#X')) return String.fromCodePoint(Number.parseInt(ent.slice(2), 16));
    if (ent.startsWith('#')) return String.fromCodePoint(Number.parseInt(ent.slice(1), 10));
    return XML_ENTITIES[ent] ?? all;
  });

function resolveRelTarget(relsPartName, target) {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return null;
  const cleaned = target.split('#')[0];
  if (!cleaned) return null;
  if (cleaned.startsWith('/')) return cleaned.replace(/^\/+/, '');
  const relsDir = pathPosix.dirname(relsPartName);
  const baseDir = relsDir === '_rels' ? '' : pathPosix.dirname(relsDir);
  return pathPosix.normalize(baseDir ? `${baseDir}/${cleaned}` : cleaned);
}

function hasBalancedRootXml(xmlText) {
  if (typeof xmlText !== 'string' || !xmlText.trim()) return false;
  const stripped = xmlText.replace(/^\uFEFF/, '').replace(/<\?xml[\s\S]*?\?>/gi, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const openMatch = /^<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>/.exec(stripped);
  if (!openMatch) return false;
  if (/\/>$/.test(stripped) && !stripped.slice(openMatch[0].length).includes('<')) return true;
  return stripped.endsWith(`</${openMatch[1]}>`);
}

/**
 * Structural OOXML package validator (Advisor decision: parts, rels, [Content_Types].xml coverage,
 * every internal relationship target present, XML well-formedness, no external binary).
 */
export function validateOoxmlPackage(bytes, { mainPart = 'word/document.xml' } = {}) {
  if (!bytes || !(bytes instanceof Uint8Array || Buffer.isBuffer(bytes)) || bytes.length === 0) {
    return blockedVerdict('missing_ooxml_bytes');
  }
  const entries = readZipEntries(bytes);
  if (!entries) return failVerdict('ooxml_invalid_zip');
  const byName = new Map();
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    if (!entry.data) return failVerdict('ooxml_corrupt_zip_entry', { part: entry.name });
    if (byName.has(entry.name)) return failVerdict('ooxml_duplicate_zip_entry', { part: entry.name });
    byName.set(entry.name, entry.data);
  }

  for (const reqPart of ['[Content_Types].xml', '_rels/.rels', mainPart]) {
    if (!byName.has(reqPart)) return failVerdict('ooxml_missing_required_part', { missingPart: reqPart });
  }

  const ctXml = byName.get('[Content_Types].xml').toString('utf8');
  if (!hasBalancedRootXml(ctXml)) return failVerdict('ooxml_malformed_xml', { part: '[Content_Types].xml' });
  const defaultExts = new Set(
    [...ctXml.matchAll(/<Default\b[^>]*\bExtension="([^"]+)"[^>]*\bContentType="([^"]+)"/g)]
      .filter((m) => m[2].trim().length > 0)
      .map((m) => m[1].toLowerCase()),
  );
  const overrides = new Map();
  for (const m of ctXml.matchAll(/<Override\b[^>]*>/g)) {
    const partName = /\bPartName="([^"]+)"/.exec(m[0])?.[1];
    const contentType = /\bContentType="([^"]+)"/.exec(m[0])?.[1];
    if (!partName || !contentType || !partName.startsWith('/')) {
      return failVerdict('ooxml_content_types_mismatch', { reason: 'invalid_override_entry', entry: m[0] });
    }
    const normalized = partName.replace(/^\/+/, '');
    if (!byName.has(normalized)) return failVerdict('ooxml_content_types_mismatch', { reason: 'override_target_missing', part: normalized });
    overrides.set(normalized, contentType);
  }

  for (const partName of byName.keys()) {
    if (partName === '[Content_Types].xml') continue;
    const base = pathPosix.basename(partName);
    const ext = (base.startsWith('.') && !base.slice(1).includes('.') ? base.slice(1) : pathPosix.extname(base).replace(/^\./, '')).toLowerCase();
    if (!overrides.has(partName) && !defaultExts.has(ext)) {
      return failVerdict('ooxml_content_types_mismatch', { reason: 'untyped_part', part: partName });
    }
    if ((ext === 'xml' || ext === 'rels') && !hasBalancedRootXml(byName.get(partName).toString('utf8'))) {
      return failVerdict('ooxml_malformed_xml', { part: partName });
    }
  }

  const relsParts = [...byName.keys()].filter((name) => name === '_rels/.rels' || name.endsWith('.rels'));
  let pointsToMain = false;
  for (const relsPart of relsParts) {
    const xml = byName.get(relsPart).toString('utf8');
    const seenIds = new Set();
    for (const rel of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(rel[0])?.[1];
      const target = /\bTarget="([^"]+)"/.exec(rel[0])?.[1];
      const mode = /\bTargetMode="([^"]+)"/.exec(rel[0])?.[1] ?? 'Internal';
      if (!id || !target) return failVerdict('ooxml_broken_relationship_target', { relsPart, entry: rel[0] });
      if (seenIds.has(id)) return failVerdict('ooxml_duplicate_relationship_id', { relsPart, id });
      seenIds.add(id);
      if (mode.toLowerCase() === 'external') continue;
      const resolved = resolveRelTarget(relsPart, target);
      if (resolved && !byName.has(resolved)) return failVerdict('ooxml_broken_relationship_target', { relsPart, id, target: resolved });
      if (relsPart === '_rels/.rels' && resolved === mainPart) pointsToMain = true;
    }
  }
  if (!pointsToMain) return failVerdict('ooxml_missing_main_part_relationship', { mainPart });

  return passVerdict('ooxml_package_valid', { partCount: byName.size, mainPart });
}

export function parseDocxStructure(docxBytes) {
  const entries = readZipEntries(docxBytes);
  if (!entries) return null;
  const byName = new Map(entries.filter((e) => !e.name.endsWith('/')).map((e) => [e.name, e.data]));
  const docBuf = byName.get('word/document.xml');
  if (!docBuf) return null;
  const xml = docBuf.toString('utf8');

  const tables = [];
  const withoutTables = xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (tblXml) => {
    const rows = [...tblXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((tr) =>
      [...tr[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((tc) =>
        [...tc[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => decodeXml(t[1])).join(''),
      ),
    );
    tables.push({ raw: tblXml, rows });
    return '';
  });

  const paragraphs = [...withoutTables.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((pMatch, index) => {
    const pXml = pMatch[0];
    const style = /<w:pStyle\b[^>]*\bw:val="([^"]+)"/.exec(pXml)?.[1] ?? 'Normal';
    const text = [...pXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => decodeXml(t[1])).join('');
    return { index, style, text, raw: pXml };
  });

  return { byName, xml, paragraphs, tables };
}

export function oracleDocxRead(observed) {
  if (!observed || !observed.fixtureBytes || typeof observed.replyText !== 'string' || !observed.replyText.trim()) {
    return blockedVerdict('missing_docx_read_artifact');
  }
  const parsed = parseDocxStructure(observed.fixtureBytes);
  if (!parsed) return failVerdict('docx_read_invalid_fixture_bytes');

  const anchors = Array.isArray(observed.citedAnchors) ? observed.citedAnchors : [];
  if (anchors.length === 0) {
    return failVerdict('docx_read_missing_anchors');
  }
  for (const anchor of anchors) {
    const idx = Number(anchor?.blockIndex);
    const para = parsed.paragraphs[idx];
    if (!Number.isInteger(idx) || !para) {
      return failVerdict('docx_read_anchor_out_of_range', { blockIndex: anchor?.blockIndex });
    }
    const quoted = String(anchor?.text ?? '').trim();
    if (!quoted || !para.text.includes(quoted)) {
      return failVerdict('docx_read_anchor_text_mismatch', { blockIndex: idx, expected: para.text, actual: quoted });
    }
  }

  const requiredTokens = observed.requiredTokens ?? ['22.060.000', 'Bắc', '9.060.000'];
  for (const token of requiredTokens) {
    if (!observed.replyText.includes(token)) {
      return failVerdict('docx_read_missing_expected_fact', { token });
    }
  }
  for (const forbidden of observed.mustNotContain ?? []) {
    if (forbidden && observed.replyText.includes(forbidden)) {
      return failVerdict('docx_read_invented_or_forbidden_fact', { token: forbidden });
    }
  }
  return passVerdict('docx_read_ok', { paragraphCount: parsed.paragraphs.length, citedCount: anchors.length });
}

export const ALLOWED_CORE_PROPS_ELEMENTS = Object.freeze(['dcterms:modified', 'cp:lastModifiedBy', 'cp:revision']);
const ALLOWED_CORE_PROPS_SET = new Set(ALLOWED_CORE_PROPS_ELEMENTS);

function parseCorePropsXml(xml) {
  const m = /^([\s\S]*?<cp:coreProperties\b([^>]*)>)([\s\S]*?)(<\/cp:coreProperties>\s*)$/.exec(String(xml ?? ''));
  if (!m) return null;
  const [, openRoot, rootAttrs, inner] = m;
  const elements = [];
  const leftover = inner.replace(/<([A-Za-z_][\w:.-]*)(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/\1>)/g, (raw, tag, attrs = '', text = '') => {
    elements.push({ tag, attrs: attrs.trim(), text, raw });
    return '';
  });
  return leftover.trim().length === 0 ? { openRoot: openRoot.trim(), rootAttrs: rootAttrs.trim(), elements } : null;
}

function firstChangedXmlElement(beforeXml, afterXml) {
  const leafRe = /<([A-Za-z_][\w:.-]*)(\s[^>]*)?(?:\/>|>([^<]*)<\/\1>)/g;
  const bLeaves = [...String(beforeXml ?? '').matchAll(leafRe)].map((m) => ({ tag: m[1], raw: m[0] }));
  const aLeaves = [...String(afterXml ?? '').matchAll(leafRe)].map((m) => ({ tag: m[1], raw: m[0] }));
  for (let i = 0; i < Math.max(bLeaves.length, aLeaves.length); i += 1) {
    if (bLeaves[i]?.raw !== aLeaves[i]?.raw) return (aLeaves[i] ?? bLeaves[i]).tag;
  }
  const openRe = /<([A-Za-z_][\w:.-]*)(\s[^>]*)?>/g;
  const bOpens = [...String(beforeXml ?? '').matchAll(openRe)].map((m) => ({ tag: m[1], raw: m[0] }));
  const aOpens = [...String(afterXml ?? '').matchAll(openRe)].map((m) => ({ tag: m[1], raw: m[0] }));
  for (let i = 0; i < Math.max(bOpens.length, aOpens.length); i += 1) {
    if (bOpens[i]?.raw !== aOpens[i]?.raw) return (aOpens[i] ?? bOpens[i]).tag;
  }
  return bOpens[0]?.tag ?? aOpens[0]?.tag ?? 'root';
}

export function findDisallowedDocxPartChange(partName, beforeBuf, afterBuf) {
  if (beforeBuf && afterBuf && beforeBuf.equals(afterBuf)) return null;
  const bXml = beforeBuf ? beforeBuf.toString('utf8') : '';
  const aXml = afterBuf ? afterBuf.toString('utf8') : '';
  if (!beforeBuf || !afterBuf || partName !== 'docProps/core.xml') {
    return { part: partName, element: firstChangedXmlElement(bXml, aXml) };
  }
  const bCore = parseCorePropsXml(bXml);
  const aCore = parseCorePropsXml(aXml);
  if (!bCore || !aCore || bCore.openRoot !== aCore.openRoot || bCore.rootAttrs !== aCore.rootAttrs) {
    return { part: partName, element: 'cp:coreProperties' };
  }
  const bOther = bCore.elements.filter((e) => !ALLOWED_CORE_PROPS_SET.has(e.tag));
  const aOther = aCore.elements.filter((e) => !ALLOWED_CORE_PROPS_SET.has(e.tag));
  for (let i = 0; i < Math.max(bOther.length, aOther.length); i += 1) {
    if (!bOther[i] || !aOther[i] || bOther[i].tag !== aOther[i].tag || bOther[i].attrs !== aOther[i].attrs || bOther[i].text !== aOther[i].text) {
      return { part: partName, element: (aOther[i] ?? bOther[i]).tag };
    }
  }
  for (const tag of ALLOWED_CORE_PROPS_ELEMENTS) {
    const bEls = bCore.elements.filter((e) => e.tag === tag);
    const aEls = aCore.elements.filter((e) => e.tag === tag);
    if (bEls.length > 1 || aEls.length > 1 || (bEls.length === 1 && aEls.length === 0)) return { part: partName, element: tag };
    if (bEls.length === 1 && aEls.length === 1 && (bEls[0].attrs !== aEls[0].attrs || /[<>]/.test(aEls[0].text))) return { part: partName, element: tag };
    if (bEls.length === 0 && aEls.length === 1) {
      const okAttr = tag === 'dcterms:modified' ? !aEls[0].attrs || aEls[0].attrs === 'xsi:type="dcterms:W3CDTF"' : !aEls[0].attrs;
      if (!okAttr || /[<>]/.test(aEls[0].text)) return { part: partName, element: tag };
    }
  }
  return null;
}

export function diffDocxNonDocumentParts(beforeBytes, afterBytes) {
  const bMap = new Map((readZipEntries(beforeBytes) ?? []).filter((e) => !e.name.endsWith('/')).map((e) => [e.name, e.data]));
  const aMap = new Map((readZipEntries(afterBytes) ?? []).filter((e) => !e.name.endsWith('/')).map((e) => [e.name, e.data]));
  const allParts = [...new Set([...bMap.keys(), ...aMap.keys()])].sort();
  const chunks = [];
  for (const part of allParts) {
    if (part === 'word/document.xml') continue;
    const bBuf = bMap.get(part);
    const aBuf = aMap.get(part);
    if (bBuf && aBuf && bBuf.equals(aBuf)) continue;
    const bLines = bBuf ? bBuf.toString('utf8').replace(/></g, '>\n<').split('\n') : [];
    const aLines = aBuf ? aBuf.toString('utf8').replace(/></g, '>\n<').split('\n') : [];
    const out = [`--- a/${part}`, `+++ b/${part}`, `@@ -1,${bLines.length} +1,${aLines.length} @@`];
    for (let i = 0; i < Math.max(bLines.length, aLines.length); i += 1) {
      if (bLines[i] === aLines[i]) out.push(` ${bLines[i]}`);
      else {
        if (bLines[i] !== undefined) out.push(`-${bLines[i]}`);
        if (aLines[i] !== undefined) out.push(`+${aLines[i]}`);
      }
    }
    chunks.push(out.join('\n'));
  }
  return chunks.length > 0 ? `${chunks.join('\n')}\n` : '# no non-document parts changed\n';
}

export function oracleDocxEdit(observed) {
  if (!observed || !observed.beforeBytes || !observed.afterBytes) return blockedVerdict('missing_docx_edit_bytes');
  const oldSha = observed.oldVersionSha256 ?? (observed.oldVersionBytes ? sha256Hex(observed.oldVersionBytes) : null);
  if (!oldSha) return blockedVerdict('missing_docx_old_version_sha256');
  const beforeSha = sha256Hex(observed.beforeBytes);
  if (oldSha !== beforeSha) return failVerdict('docx_old_version_sha256_changed', { expected: beforeSha, actual: oldSha });

  const pkgCheck = validateOoxmlPackage(observed.afterBytes, { mainPart: 'word/document.xml' });
  if (pkgCheck.status !== VERDICT.PASS) return pkgCheck;

  const roundTripResult = typeof observed.roundTripHook === 'function' ? observed.roundTripHook(observed.afterBytes) : observed.roundTrip;
  if (!roundTripResult || typeof roundTripResult !== 'object') return blockedVerdict('missing_docx_round_trip_result');
  // A round trip that could not load the engine helpers reports BLOCKED with a
  // named reason (e.g. `docx_normalizer_unavailable`); it is never a FAIL and
  // never a PASS.
  if (roundTripResult.status === VERDICT.BLOCKED && roundTripResult.reason) {
    return blockedVerdict(roundTripResult.reason, { roundTrip: roundTripResult });
  }
  if (roundTripResult.normalizedOk !== true || roundTripResult.roundTripOk !== true) {
    return failVerdict('docx_ooxml_normalize_or_round_trip_failed', { roundTrip: roundTripResult });
  }

  const before = parseDocxStructure(observed.beforeBytes);
  const after = parseDocxStructure(observed.afterBytes);
  if (!before || !after) return failVerdict('docx_edit_unparseable_structure');

  const allParts = new Set([...before.byName.keys(), ...after.byName.keys()]);
  for (const partName of allParts) {
    if (partName === 'word/document.xml') continue;
    const disallowed = findDisallowedDocxPartChange(partName, before.byName.get(partName), after.byName.get(partName));
    if (disallowed) return failVerdict('docx_non_document_part_modified', disallowed);
  }

  if (JSON.stringify(before.tables.map((t) => t.rows)) !== JSON.stringify(after.tables.map((t) => t.rows))) {
    return failVerdict('docx_tables_modified');
  }
  if (before.paragraphs.length !== after.paragraphs.length) {
    return failVerdict('docx_paragraph_count_changed', { before: before.paragraphs.length, after: after.paragraphs.length });
  }

  const rawTargets = Array.isArray(observed.targetParagraphIndexes)
    ? observed.targetParagraphIndexes
    : Number.isInteger(observed.targetParagraphIndex) ? [observed.targetParagraphIndex] : null;
  if (!rawTargets || rawTargets.length === 0 || !rawTargets.every((idx) => Number.isInteger(idx) && idx >= 0)) {
    return blockedVerdict('missing_docx_target_paragraph');
  }
  const rawTokens =
    observed.requiredTokens ?? observed.target?.requiredTokens ??
    (typeof observed.expectedText === 'string' && observed.expectedText.trim() ? [observed.expectedText.trim()] : null);
  const requiredTokens = Array.isArray(rawTokens) ? rawTokens.filter((t) => typeof t === 'string' && t.trim().length > 0) : [];
  if (requiredTokens.length === 0) return blockedVerdict('missing_docx_expected_tokens');

  const targets = new Set(rawTargets);
  let targetChanged = false;
  for (let i = 0; i < before.paragraphs.length; i += 1) {
    const same = before.paragraphs[i].text === after.paragraphs[i].text;
    if (targets.has(i)) {
      if (!same && after.paragraphs[i].text.trim().length > 0) targetChanged = true;
    } else if (!same) {
      return failVerdict('docx_untouched_paragraph_modified', { paragraphIndex: i });
    }
  }
  if (!targetChanged) return failVerdict('docx_target_paragraph_unchanged', { targetParagraphIndexes: [...targets] });

  const combinedTargetText = [...targets].map((idx) => after.paragraphs[idx]?.text ?? '').join('\n');
  for (const token of requiredTokens) {
    if (!combinedTargetText.includes(token)) {
      return failVerdict('docx_target_paragraph_missing_expected_token', { token, actual: combinedTargetText });
    }
  }

  return passVerdict('docx_edit_ok', { targetParagraphIndexes: [...targets], paragraphCount: after.paragraphs.length });
}

export function parsePptxStructure(pptxBytes) {
  const entries = readZipEntries(pptxBytes);
  if (!entries) return null;
  const byName = new Map(entries.filter((e) => !e.name.endsWith('/')).map((e) => [e.name, e.data]));
  const presBuf = byName.get('ppt/presentation.xml');
  if (!presBuf) return null;
  const slideNames = [...byName.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/\d+/.exec(a)[0]) - Number(/\d+/.exec(b)[0]));

  const slides = slideNames.map((name, idx) => {
    const xml = byName.get(name).toString('utf8');
    const shapes = [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map((spMatch) => {
      const spXml = spMatch[0];
      const id = Number(/<p:cNvPr\b[^>]*\bid="(\d+)"/.exec(spXml)?.[1] ?? 0);
      const shapeName = decodeXml(/<p:cNvPr\b[^>]*\bname="([^"]*)"/.exec(spXml)?.[1] ?? '');
      const xfrm = /<a:xfrm\b[\s\S]*?<\/a:xfrm>/.exec(spXml)?.[0] ?? '';
      const paragraphs = [...spXml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map((p) =>
        [...p[0].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXml(t[1])).join(''),
      );
      return { id, name: shapeName, xfrm, text: paragraphs.join('\n'), paragraphs };
    });
    const graphicFrames = [...xml.matchAll(/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g)].map((g) => g[0]);
    return { index: idx + 1, part: name, shapes, graphicFrames };
  });

  const sldIds = [...presBuf.toString('utf8').matchAll(/<p:sldId\b[^>]*>/g)].map((m) => m[0]);
  return { byName, slides, slideCount: slides.length, sldIds };
}

export function oraclePptxRead(observed) {
  if (!observed || !observed.fixtureBytes || typeof observed.replyText !== 'string' || !observed.replyText.trim()) {
    return blockedVerdict('missing_pptx_read_artifact');
  }
  const parsed = parsePptxStructure(observed.fixtureBytes);
  if (!parsed) return failVerdict('pptx_read_invalid_fixture_bytes');

  for (const slide of parsed.slides) {
    for (const shape of slide.shapes) {
      if (shape.text && !observed.replyText.includes(shape.paragraphs[0])) {
        return failVerdict('pptx_read_missing_slide_shape_text', {
          slideIndex: slide.index,
          shapeId: shape.id,
          expected: shape.paragraphs[0],
        });
      }
    }
  }
  return passVerdict('pptx_read_ok', { slideCount: parsed.slideCount });
}

export function oraclePptxEdit(observed) {
  if (!observed || !observed.beforeBytes || !observed.afterBytes) {
    return blockedVerdict('missing_pptx_edit_bytes');
  }
  if (!Number.isInteger(observed.targetSlideIndex) || !Number.isInteger(observed.targetShapeId)) {
    return blockedVerdict('missing_pptx_target_shape');
  }
  if (typeof observed.expectedText !== 'string' || !observed.expectedText.trim()) {
    return blockedVerdict('missing_pptx_expected_text');
  }
  const pkgCheck = validateOoxmlPackage(observed.afterBytes, { mainPart: 'ppt/presentation.xml' });
  if (pkgCheck.status !== VERDICT.PASS) return pkgCheck;

  const before = parsePptxStructure(observed.beforeBytes);
  const after = parsePptxStructure(observed.afterBytes);
  if (!before || !after) return failVerdict('pptx_edit_unparseable_structure');

  if (before.slideCount !== after.slideCount || before.sldIds.length !== after.sldIds.length) {
    return failVerdict('pptx_slide_count_changed', { before: before.slideCount, after: after.slideCount });
  }

  const targetSlide = observed.targetSlideIndex;
  const targetShapeId = observed.targetShapeId;
  let targetModified = false;

  for (let s = 0; s < before.slides.length; s += 1) {
    const bSlide = before.slides[s];
    const aSlide = after.slides[s];
    if (bSlide.shapes.length !== aSlide.shapes.length || JSON.stringify(bSlide.graphicFrames) !== JSON.stringify(aSlide.graphicFrames)) {
      return failVerdict('pptx_shape_count_or_layout_changed', { slideIndex: bSlide.index });
    }
    for (let i = 0; i < bSlide.shapes.length; i += 1) {
      const bShape = bSlide.shapes[i];
      const aShape = aSlide.shapes[i];
      if (bShape.id !== aShape.id || bShape.xfrm !== aShape.xfrm) {
        return failVerdict('pptx_shape_count_or_layout_changed', { slideIndex: bSlide.index, shapeId: bShape.id });
      }
      const isTarget = bSlide.index === targetSlide && bShape.id === targetShapeId;
      if (isTarget) {
        if (bShape.text !== aShape.text && aShape.text.trim().length > 0) {
          if (aShape.text.trim() !== observed.expectedText.trim()) {
            return failVerdict('pptx_target_shape_unexpected_text', {
              expected: observed.expectedText,
              actual: aShape.text,
            });
          }
          targetModified = true;
        }
      } else if (bShape.text !== aShape.text) {
        return failVerdict('pptx_non_target_shape_modified', { slideIndex: bSlide.index, shapeId: bShape.id });
      }
    }
  }
  if (!targetModified) {
    return failVerdict('pptx_target_shape_unchanged', { targetSlide, targetShapeId });
  }
  return passVerdict('pptx_edit_ok', { slideCount: after.slideCount, targetSlide, targetShapeId });
}

function inflateFlate(buf) {
  let end = buf.length;
  while (end >= 0) {
    try { return inflateSync(buf.subarray(0, end)); } catch {}
    if (end === 0 || ![9, 10, 12, 13, 32].includes(buf[end - 1])) break;
    end -= 1;
  }
  return null;
}

function parseCmap(body) {
  const map = new Map();
  const setCp = (gid, cp) => {
    if (cp >= 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff)) map.set(gid, String.fromCodePoint(cp));
  };
  for (const b of body.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of b[1].matchAll(/<([0-9A-Fa-f]{1,4})>\s*<([0-9A-Fa-f]{1,8})>/g)) {
      setCp(p[1].toUpperCase().padStart(4, '0'), Number.parseInt(p[2], 16));
    }
  }
  for (const b of body.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of b[1].matchAll(/<([0-9A-Fa-f]{1,4})>\s*<([0-9A-Fa-f]{1,4})>\s*(?:\[([^\]]*)\]|<([0-9A-Fa-f]{1,8})>)/g)) {
      const [lo, hi] = [Number.parseInt(m[1], 16), Number.parseInt(m[2], 16)];
      const list = m[3] !== undefined ? [...m[3].matchAll(/<([0-9A-Fa-f]{1,8})>/g)].map((t) => Number.parseInt(t[1], 16)) : null;
      const base = m[4] !== undefined ? Number.parseInt(m[4], 16) : 0;
      for (let i = 0; i <= hi - lo && (!list || i < list.length); i += 1) {
        setCp((lo + i).toString(16).toUpperCase().padStart(4, '0'), list ? list[i] : base + i);
      }
    }
  }
  if (map.size === 0) {
    for (const p of body.matchAll(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4})>/g)) {
      setCp(p[1].toUpperCase(), Number.parseInt(p[2], 16));
    }
  }
  return map;
}

function parseWidths(wBody) {
  const wMap = new Map();
  for (const e of wBody.matchAll(/(\d+)\s*\[\s*([\d.\s-]+)\]/g)) {
    e[2].trim().split(/\s+/).forEach((w, i) => wMap.set(Number(e[1]) + i, Number(w)));
  }
  return wMap;
}

export function extractPdfTextFromBytes(pdfBytes) {
  if (!pdfBytes || !(pdfBytes instanceof Uint8Array || Buffer.isBuffer(pdfBytes))) return null;
  const buf = Buffer.from(pdfBytes);
  const raw = buf.toString('latin1');
  if (!raw.startsWith('%PDF-')) return null;

  const [objTexts, streamByObj, corruptStreams, streams] = [new Map(), new Map(), new Set(), []];
  let [rootId, rootPos] = [0, -1];
  for (const m of raw.matchAll(/(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g)) {
    const [objId, body] = [Number(m[1]), m[2]];
    const sMatch = />>\s*stream(?:\r\n|\n|\r)/.exec(body);
    const eIdx = body.lastIndexOf('endstream');
    if (!sMatch || eIdx < 0) { objTexts.set(objId, body); continue; }
    const dict = body.slice(0, sMatch.index + 2);
    objTexts.set(objId, dict);
    if (/\/Type\s*\/XRef\b/.test(dict)) {
      const xr = /\/Root\s+(\d+)\s+\d+\s+R\b/.exec(dict);
      if (xr) [rootId, rootPos] = [Number(xr[1]), m.index];
    }
    const base = m.index + m[0].indexOf(body);
    let end = base + eIdx;
    if (buf[end - 2] === 13 && buf[end - 1] === 10) end -= 2;
    else if (buf[end - 1] === 10 || buf[end - 1] === 13) end -= 1;
    const slice = buf.subarray(base + sMatch.index + sMatch[0].length, end);
    const isFlate = /\/Filter\s*(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])/.test(dict);
    const text = isFlate ? inflateFlate(slice)?.toString('latin1') : slice.toString('latin1');
    if (text === undefined) { corruptStreams.add(objId); streamByObj.delete(objId); continue; }
    corruptStreams.delete(objId);
    streams.push({ objId, text });
    streamByObj.set(objId, text);
    if (/\/Type\s*\/ObjStm\b/.test(dict)) {
      const [n, first] = [Number(/\/N\s+(\d+)/.exec(dict)?.[1] ?? 0), Number(/\/First\s+(\d+)/.exec(dict)?.[1] ?? 0)];
      if (n > 0 && first > 0 && first <= text.length) {
        const nums = text.slice(0, first).trim().split(/\s+/).map(Number);
        const tail = text.slice(first);
        for (let i = 0; i < n && i * 2 + 1 < nums.length; i += 1) {
          objTexts.set(nums[i * 2], tail.slice(nums[i * 2 + 1], i + 1 < n ? nums[(i + 1) * 2 + 1] : tail.length));
        }
      }
    }
  }
  for (const tm of raw.matchAll(/trailer\s*<<(?:(?!startxref|%%EOF)[\s\S])*?\/Root\s+(\d+)\s+\d+\s+R\b/g)) {
    if (tm.index > rootPos) [rootId, rootPos] = [Number(tm[1]), tm.index];
  }

  const catText = objTexts.get(rootId) ?? '';
  const pagesRoot = /\/Type\s*\/Catalog\b/.test(catText) ? Number(/\/Pages\s+(\d+)\s+\d+\s+R\b/.exec(catText)?.[1] ?? 0) : 0;
  if (!pagesRoot || !/\/Type\s*\/Pages\b/.test(objTexts.get(pagesRoot) ?? '')) return null;

  const [pageStreams, seenNodes] = [[], new Set()];
  const walkPages = (id) => {
    if (seenNodes.has(id) || !objTexts.has(id)) return false;
    seenNodes.add(id);
    const t = objTexts.get(id);
    if (/\/Type\s*\/Pages\b/.test(t)) {
      const km = /\/Kids\s*\[([\s\S]*?)\]/.exec(t);
      if (!km) return false;
      const kids = [...km[1].matchAll(/(\d+)\s+\d+\s+R\b/g)].map((r) => Number(r[1]));
      if (kids.length === 0 && km[1].trim().length > 0) return false;
      return kids.every(walkPages);
    }
    if (!/\/Type\s*\/Page\b/.test(t)) return false;
    const cm = /\/Contents\s*(?:\[([\s\S]*?)\]|(\d+)\s+\d+\s+R\b)/.exec(t);
    if (/\/Contents\b/.test(t) && !cm) return false;
    const refs = cm ? (cm[2] ? [Number(cm[2])] : [...cm[1].matchAll(/(\d+)\s+\d+\s+R\b/g)].map((r) => Number(r[1]))) : [];
    if (cm && !cm[2] && refs.length === 0 && cm[1].trim().length > 0) return false;
    const texts = [];
    for (const ref of refs) {
      if (corruptStreams.has(ref) || !streamByObj.has(ref)) return false;
      texts.push(streamByObj.get(ref));
    }
    pageStreams.push(texts);
    return true;
  };
  if (!walkPages(pagesRoot) || pageStreams.length === 0) return null;
  const pageCount = pageStreams.length;
  const [cmapByObj, cmaps, fontToCmap, fontToDesc, objWidths, fontRes] = [new Map(), [], new Map(), new Map(), new Map(), new Map()];
  for (const s of streams) {
    for (const cm of s.text.matchAll(/begincmap([\s\S]*?)endcmap/g)) {
      const map = parseCmap(cm[1]);
      cmaps.push(map);
      cmapByObj.set(s.objId, map);
    }
  }
  for (const [id, t] of objTexts) {
    const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(t);
    if (tu) fontToCmap.set(id, Number(tu[1]));
    const df = /\/DescendantFonts\s*\[\s*(\d+)\s+0\s+R/.exec(t);
    if (df) fontToDesc.set(id, Number(df[1]));
    const wIn = /\/W\s*\[([\s\S]*?)\]\s*(?:\/|>>|$)/.exec(t);
    if (wIn) objWidths.set(id, parseWidths(wIn[1]));
    else if (/^\s*\[[\s\S]*\]\s*$/.test(t)) objWidths.set(id, parseWidths(t));
    const wRef = /\/W\s+(\d+)\s+0\s+R/.exec(t);
    if (wRef && objTexts.has(Number(wRef[1]))) objWidths.set(id, parseWidths(objTexts.get(Number(wRef[1]))));
    for (const fm of t.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) {
      for (const p of fm[1].matchAll(/\/([A-Za-z0-9_]+)\s+(\d+)\s+0\s+R/g)) fontRes.set(p[1], Number(p[2]));
    }
  }

  const decodeHex = (hexStr, cmap, wMap, sz) => {
    const hex = hexStr.replace(/\s+/g, '').toUpperCase();
    const step = hex.length % 4 === 0 ? 4 : 2;
    let [text, wSum] = ['', 0];
    for (let i = 0; i + step <= hex.length; i += step) {
      const gid = hex.slice(i, i + step).padStart(4, '0');
      text += cmap.get(gid) ?? '';
      wSum += wMap?.get(Number.parseInt(gid, 16)) ?? 600;
    }
    return { text, width: (wSum / 1000) * sz };
  };

  const runs = [];
  const pushRun = (page, text, x, y, width) => {
    if (!text) return;
    const prev = runs[runs.length - 1];
    if (prev && prev.page === page && Math.abs(prev.y - y) < 0.5 && Math.abs(x - prev.endX) < 3) {
      prev.text += text;
      prev.endX = x + width;
    } else {
      runs.push({ page, text, y, endX: x + width });
    }
  };

  const opRe = /\/([A-Za-z0-9_]+)\s+([\d.]+)\s+Tf\b|([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+Tm\b|([\d.-]+)\s+([\d.-]+)\s+T[dD]\b|\[\s*((?:<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)|[\d.\s-])+)\s*\]\s*TJ\b|<([0-9A-Fa-f\s]+)>\s*Tj\b|\(((?:\\.|[^\\)])*)\)\s*Tj\b/g;
  for (let pageIdx = 0; pageIdx < pageStreams.length; pageIdx += 1) {
    for (const sText of pageStreams[pageIdx]) {
      if (sText.includes('begincmap') || !sText.includes('BT')) continue;
      let [lastEnd, cm] = [0, [1, 0, 0, 1, 0, 0]];
      for (const bt of sText.matchAll(/BT\b([\s\S]*?)ET\b/g)) {
        const pre = sText.slice(lastEnd, bt.index);
        if (/\bQ\b/.test(pre)) cm = [1, 0, 0, 1, 0, 0];
        for (const m of pre.matchAll(/([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+cm\b/g)) {
          cm = m.slice(1, 7).map(Number);
        }
        lastEnd = bt.index + bt[0].length;
        let [fontName, fontSize, tx, ty] = ['F1', 11, cm[4], cm[5]];
        for (const op of bt[1].matchAll(opRe)) {
          if (op[1] !== undefined) { fontName = op[1]; fontSize = Number(op[2]); continue; }
          if (op[3] !== undefined) { tx = cm[4] + Number(op[7]); ty = cm[5] + Number(op[8]); continue; }
          if (op[9] !== undefined) { tx += Number(op[9]); ty += Number(op[10]); continue; }
          const fObj = fontRes.get(fontName);
          const cmap = (fObj && cmapByObj.get(fontToCmap.get(fObj)))
            ?? cmaps[Number(/\d+$/.exec(fontName)?.[0] ?? 1) - 1] ?? cmaps[0] ?? new Map();
          const wMap = (fObj && objWidths.get(fontToDesc.get(fObj) ?? fObj)) ?? null;
          if (op[11] !== undefined) {
            let [line, width] = ['', 0];
            for (const part of op[11].matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\)|(-?[\d.]+)/g)) {
              if (part[1] !== undefined) {
                const d = decodeHex(part[1], cmap, wMap, fontSize);
                line += d.text; width += d.width;
              } else if (part[2] !== undefined) {
                line += part[2]; width += part[2].length * fontSize * 0.5;
              } else if (part[3] !== undefined) {
                width -= (Number(part[3]) / 1000) * fontSize;
              }
            }
            pushRun(pageIdx, line, tx, ty, width);
            tx += width;
          } else if (op[12] !== undefined) {
            const d = decodeHex(op[12], cmap, wMap, fontSize);
            pushRun(pageIdx, d.text, tx, ty, d.width);
            tx += d.width;
          } else if (op[13] !== undefined) {
            const w = op[13].length * fontSize * 0.5;
            pushRun(pageIdx, op[13], tx, ty, w);
            tx += w;
          }
        }
      }
    }
  }
  return { pageCount, lines: runs.map((r) => r.text), hasToUnicode: cmaps.length > 0 };
}
