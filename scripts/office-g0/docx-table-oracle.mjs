// UNI-667 DOCX table-cycle independent oracle.
//
// Reads a saved DOCX package with Node built-ins only and answers ONE question
// honestly: does this package carry `newText` at the cell at the caller's
// independent grid identity, while the neighbouring cells, the retained
// paragraph text, the media part, the document relationships and the table
// structure are still the ones the authored fixture had?
//
// The grid identity is (tableIndex, row, col) in DOCX document order, counted
// from the fixture the caller reads itself - never from the editor DOM or a
// renderer model. A package that moved the text to a different cell, dropped the
// table or is byte-identical to the stale fixture fails by name.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

export const ORACLE_ID = 'office-g0-docx-table-oracle-r1';
export const ORACLE_VERSION = 1;
export const DOCUMENT_PART = 'word/document.xml';
export const DOCUMENT_RELS_PART = 'word/_rels/document.xml.rels';

/** Failure carrying a stable code; callers assert on `code`, never on prose. */
export class DocxTableOracleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DocxTableOracleError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new DocxTableOracleError(code, message);
};

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * A small independent ZIP reader (stored/deflated entries only). Zip64 and
 * unknown methods raise by name: an unreadable package is never a pass.
 */
export function readZipParts(bytes) {
  const eocd = 0x06054b50;
  const central = 0x02014b50;
  const local = 0x04034b50;
  let eocdOffset = -1;
  for (let i = Math.max(0, bytes.length - 22 - 0xffff); i <= bytes.length - 22; i += 1) {
    if (bytes.readUInt32LE(i) === eocd) eocdOffset = i;
  }
  if (eocdOffset < 0) fail('package_has_no_eocd', 'DOCX package has no end-of-central-directory record');
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    fail('zip64_unsupported', 'this oracle does not read Zip64 packages');
  }
  const parts = new Map();
  let cursor = centralOffset;
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== central) {
      fail('bad_central_directory', 'bad central-directory entry ' + entry);
    }
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== local) {
      fail('bad_local_header', 'bad local header for ' + name);
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    const value = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (value === null) fail('unsupported_zip_method', 'unsupported ZIP method ' + method + ' for ' + name);
    if (value.length !== uncompressedSize) fail('zip_size_mismatch', 'size mismatch for ' + name);
    if (parts.has(name)) fail('duplicate_zip_part', 'duplicate ZIP part ' + name);
    parts.set(name, value);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return parts;
}

export function requiredPart(parts, name) {
  const value = parts.get(name);
  if (!value) fail('package_part_missing', 'DOCX package is missing ' + name);
  return value;
}

/** Media payloads by part name; directory placeholders are not payloads. */
export function mediaParts(parts) {
  return new Map([...parts].filter(([name]) => name.startsWith('word/media/') && !name.endsWith('/')));
}

/** Every non-directory part name, sorted. */
export const partNames = (parts) => [...parts.keys()].filter((name) => !name.endsWith('/')).sort();

export function decodeXmlText(raw) {
  return String(raw)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, String.fromCharCode(34))
    .replace(/&apos;/g, String.fromCharCode(39))
    .replace(/&amp;/g, '&');
}

/**
 * Top-level element segments for one tag inside `[from, to)`. Depth tracking
 * keeps a `<w:p>` inside `<w:tc>` from being reported as a second row, and a
 * self-closing element is returned as its own segment (`<w:tc/>`).
 */
export function xmlSegments(xml, tag, from = 0, to = xml.length) {
  const openPrefix = '<' + tag;
  const closeTag = '</' + tag + '>';
  const segments = [];
  let depth = 0;
  let start = -1;
  let i = from;
  while (i < to) {
    const open = xml.indexOf(openPrefix, i);
    const close = xml.indexOf(closeTag, i);
    const hasOpen = open !== -1 && open < to;
    const hasClose = close !== -1 && close < to;
    if (!hasOpen && !hasClose) break;
    if (hasOpen && (!hasClose || open < close)) {
      const after = xml.charAt(open + openPrefix.length);
      if (after !== '>' && after !== ' ' && after !== '/') {
        i = open + openPrefix.length;
        continue;
      }
      const gt = xml.indexOf('>', open);
      if (gt === -1 || gt >= to) fail('malformed_xml', 'unterminated <' + tag + '>');
      if (xml.charAt(gt - 1) === '/') {
        if (depth === 0) segments.push({ start: open, end: gt + 1 });
        i = gt + 1;
        continue;
      }
      if (depth === 0) start = open;
      depth += 1;
      i = gt + 1;
      continue;
    }
    depth -= 1;
    i = close + closeTag.length;
    if (depth === 0 && start !== -1) {
      segments.push({ start, end: i });
      start = -1;
    }
    if (depth < 0) fail('malformed_xml', 'unbalanced </' + tag + '>');
  }
  if (depth !== 0) fail('malformed_xml', 'unbalanced <' + tag + '> in the document part');
  return segments;
}

/** Concatenated w:t text of one fragment. */
export function textOf(fragment) {
  let text = '';
  for (const seg of xmlSegments(fragment, 'w:t')) {
    const open = fragment.indexOf('>', seg.start);
    text += decodeXmlText(fragment.slice(open + 1, seg.end - '</w:t>'.length));
  }
  return text;
}

/**
 * Reads the body's top-level tables. Nested tables (a `<w:tbl>` inside a
 * `<w:tc>`) stay out of the top-level list: this feature's grid identity is the
 * document's own table order.
 */
export function readTables(xml) {
  const bodySeg = xmlSegments(xml, 'w:body')[0];
  if (!bodySeg) fail('document_has_no_body', 'word/document.xml has no w:body');
  const body = xml.slice(bodySeg.start, bodySeg.end);
  return xmlSegments(body, 'w:tbl').map((tblSeg) => {
    const tbl = body.slice(tblSeg.start, tblSeg.end);
    const rows = xmlSegments(tbl, 'w:tr').map((trSeg) => {
      const tr = tbl.slice(trSeg.start, trSeg.end);
      return xmlSegments(tr, 'w:tc').map((tcSeg) => {
        const tc = tr.slice(tcSeg.start, tcSeg.end);
        const openLength = /^<w:tc(?:\s[^>]*)?>/.exec(tc)?.[0]?.length ?? 0;
        const selfClosing = /^<w:tc[^>]*\/>$/.test(tc);
        const paras = selfClosing ? [] : xmlSegments(tc, 'w:p', openLength, tc.length);
        return {
          paras: paras.map((p) => textOf(tc.slice(p.start, p.end))),
          hasNestedTable: !selfClosing && xmlSegments(tc, 'w:tbl', openLength, tc.length).length > 0,
          hasDrawing: tc.includes('<w:drawing'),
        };
      });
    });
    return { rows };
  });
}

/** A structural signature that changes only when the table shape changes. */
export function tableStructure(tables) {
  return tables
    .map((t) => t.rows.map((r) => r.map((c) => (c.hasNestedTable ? 'n' : 'c')).join('')).join('|'))
    .join('//');
}

/** `texts[row][cell]` for one table. */
export const tableTextGrid = (table) => table.rows.map((row) => row.map((cell) => cell.paras.join('\n')));

/**
 * Top-level body paragraph texts: every `w:p` that is NOT inside a `w:tbl`.
 * Retained prose must survive as body text, so a string that only survives
 * elsewhere in the part (a table cell, a deleted-text mark, an attribute value)
 * never counts as retained.
 */
export function bodyParagraphTexts(xml) {
  const bodySeg = xmlSegments(xml, 'w:body')[0];
  if (!bodySeg) fail('document_has_no_body', 'word/document.xml has no w:body');
  const body = xml.slice(bodySeg.start, bodySeg.end);
  const tableSpans = xmlSegments(body, 'w:tbl');
  const insideTable = (seg) => tableSpans.some((tbl) => seg.start > tbl.start && seg.start < tbl.end);
  return xmlSegments(body, 'w:p')
    .filter((seg) => !insideTable(seg))
    .map((seg) => textOf(body.slice(seg.start, seg.end)));
}

/** Resolves one document-order cell; an identity outside the grid fails by name. */
export function cellAt(tables, identity) {
  const { tableIndex, row, col } = identity;
  const table = tables[tableIndex];
  if (!table) {
    fail('table_missing', 'tableIndex ' + tableIndex + ' is outside the ' + tables.length + ' top-level table(s)');
  }
  const cells = table.rows[row];
  if (!cells) {
    fail('table_row_missing', 'row ' + row + ' is outside table ' + tableIndex + ' which has ' + table.rows.length + ' row(s)');
  }
  const cell = cells[col];
  if (!cell) {
    fail('table_cell_missing', 'cell ' + col + ' is outside row ' + row + ' which has ' + cells.length + ' cell(s)');
  }
  return cell;
}

/**
 * The one assessment this oracle exists for. Expectations come from the caller's
 * own reading of the authored fixture; nothing is derived from the editor.
 */
export function assessDocxTableBytes({
  fixtureBytes,
  savedBytes,
  identity,
  newText,
  neighbourIdentities = [],
  retainedParagraphTexts = [],
}) {
  if (!Buffer.isBuffer(fixtureBytes) || !Buffer.isBuffer(savedBytes)) {
    fail('bytes_required', 'fixtureBytes and savedBytes must be Buffers');
  }
  if (typeof newText !== 'string' || newText.length === 0) {
    fail('new_text_required', 'newText must be a non-empty string');
  }
  const fixtureParts = readZipParts(fixtureBytes);
  const savedParts = readZipParts(savedBytes);
  const fixtureXml = requiredPart(fixtureParts, DOCUMENT_PART).toString('utf8');
  const savedXml = requiredPart(savedParts, DOCUMENT_PART).toString('utf8');
  const fixtureTables = readTables(fixtureXml);
  const savedTables = readTables(savedXml);
  if (fixtureTables.length === 0) fail('fixture_has_no_table', 'the authored fixture has no top-level table');

  const fixtureCell = cellAt(fixtureTables, identity);
  const savedCell = cellAt(savedTables, identity);
  const targetText = savedCell.paras.join('\n');

  // Every other cell in the target table must keep the fixture's text, so a save
  // that rewrote a neighbour (or the whole table) is caught even when the target
  // cell itself looks right.
  const fixtureGrid = tableTextGrid(fixtureTables[identity.tableIndex]);
  const savedGrid = tableTextGrid(savedTables[identity.tableIndex]);
  const neighbourDiffs = [];
  savedTables[identity.tableIndex].rows.forEach((row, r) => {
    row.forEach((_, c) => {
      if (r === identity.row && c === identity.col) return;
      const before = fixtureGrid[r]?.[c];
      const after = savedGrid[r]?.[c];
      if (before !== after) neighbourDiffs.push({ row: r, col: c, before, after });
    });
  });

  // Caller-named neighbours are asserted by identity too, so an explicit
  // expectation can never be silently satisfied by the sweep above.
  const namedNeighbourDiffs = [];
  for (const named of neighbourIdentities) {
    const before = cellAt(fixtureTables, named).paras.join('\n');
    const after = cellAt(savedTables, named).paras.join('\n');
    if (before !== after) namedNeighbourDiffs.push({ identity: named, before, after });
  }

  // Retained prose is matched against TOP-LEVEL body paragraphs on BOTH sides, so
  // a string that was never in the authored body, or that only survives inside a
  // table cell while its paragraph is gone, fails instead of passing on a raw
  // document.xml substring.
  const fixtureBodyParagraphs = bodyParagraphTexts(fixtureXml);
  const savedBodyParagraphs = bodyParagraphTexts(savedXml);
  const bodyHasText = (paragraphs, expected) => paragraphs.some((paragraph) => paragraph.includes(expected));
  const paragraphRetention = retainedParagraphTexts.map((expected) => ({
    expected,
    fixtureHas: bodyHasText(fixtureBodyParagraphs, expected),
    savedHas: bodyHasText(savedBodyParagraphs, expected),
  }));

  const structureBefore = tableStructure(fixtureTables);
  const structureAfter = tableStructure(savedTables);

  const fixtureMedia = mediaParts(fixtureParts);
  const savedMedia = mediaParts(savedParts);
  const mediaNamesMatch =
    JSON.stringify([...fixtureMedia.keys()].sort()) === JSON.stringify([...savedMedia.keys()].sort());
  const mediaByteEqual =
    mediaNamesMatch && [...fixtureMedia].every(([name, before]) => savedMedia.get(name).equals(before));
  const relsByteEqual = requiredPart(fixtureParts, DOCUMENT_RELS_PART).equals(
    requiredPart(savedParts, DOCUMENT_RELS_PART),
  );

  const checks = {
    targetHasNewText: targetText.includes(newText),
    targetIsNotTheAuthoredText: fixtureCell.paras.join('\n') !== targetText,
    savedDiffersFromFixtureBytes: !savedBytes.equals(fixtureBytes),
    savedDiffersFromFixtureHash: sha256(savedBytes) !== sha256(fixtureBytes),
    neighboursUnchanged: neighbourDiffs.length === 0,
    namedNeighboursUnchanged: namedNeighbourDiffs.length === 0,
    retainedParagraphsPresent: paragraphRetention.every((p) => p.fixtureHas && p.savedHas),
    tableStructurePreserved: structureBefore === structureAfter,
    mediaByteEqual,
    relationshipsByteEqual: relsByteEqual,
  };
  return {
    oracle: ORACLE_ID,
    version: ORACLE_VERSION,
    pass: Object.values(checks).every(Boolean),
    identity,
    newText,
    targetText,
    checks,
    neighbourDiffs,
    namedNeighbourDiffs,
    paragraphRetention,
    structureBefore,
    structureAfter,
    fixture: { sha256: sha256(fixtureBytes), bytes: fixtureBytes.length },
    saved: { sha256: sha256(savedBytes), bytes: savedBytes.length },
    mediaParts: [...savedMedia.keys()].sort(),
    partNames: partNames(savedParts),
  };
}

/** File-based wrapper; a missing or unreadable file is a named failure. */
export function assessDocxTableFile({ fixturePath, savedPath, ...rest }) {
  let fixtureBytes;
  let savedBytes;
  try {
    fixtureBytes = readFileSync(fixturePath);
    savedBytes = readFileSync(savedPath);
  } catch (error) {
    fail('file_read_failed', String(error && error.message ? error.message : error));
  }
  return assessDocxTableBytes({ fixtureBytes, savedBytes, ...rest });
}
