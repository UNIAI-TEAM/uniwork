// Fixture and package readers shared by the G7/G8 harness drivers (moved
// unchanged from g7-10/tracer.mjs for G8-19, UNI-1414): the verified fixture
// loader over docs/office/g5g6g7/fixtures/manifest.json, a zip reader that
// inflates every entry, and the first-sheet XLSX cell reader.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, "../../../..");
export const MANIFEST_REL = "docs/office/g5g6g7/fixtures/manifest.json";

export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function loadManifest(repoRoot = DEFAULT_REPO_ROOT) {
  return JSON.parse(readFileSync(join(repoRoot, MANIFEST_REL), "utf8"));
}

export function loadVerifiedFixture(fixtureId, repoRoot = DEFAULT_REPO_ROOT) {
  const manifest = loadManifest(repoRoot);
  const entry = manifest.fixtures.find((f) => f.id === fixtureId);
  if (!entry) {
    throw new Error(`fixture "${fixtureId}" is not in ${MANIFEST_REL}`);
  }
  const absPath = resolve(repoRoot, entry.path);
  const bytes = readFileSync(absPath);
  const actualSha = sha256Hex(bytes);
  if (actualSha !== entry.sha256) {
    throw new Error(
      `fixture ${fixtureId} sha256 mismatch: expected ${entry.sha256}, got ${actualSha}`,
    );
  }
  return { entry, absPath, bytes, sha256: actualSha };
}

/**
 * The XML entries of a ZIP buffer, `{name, data}` per entry (supports both the
 * stored method 0 and the deflated method 8). null for a buffer that is not a
 * readable zip, so a caller can say why it read nothing.
 */
export function readZipEntries(xlsxBytes) {
  if (!xlsxBytes || xlsxBytes.length < 22) return null;
  const buf = Buffer.isBuffer(xlsxBytes) ? xlsxBytes : Buffer.from(xlsxBytes);
  try {
    let eocdOffset = -1;
    const minEocd = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= minEocd; i -= 1) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0) return null;
    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    let pos = cdOffset;
    const entries = [];
    for (let idx = 0; idx < totalEntries && pos + 46 <= buf.length; idx += 1) {
      if (buf.readUInt32LE(pos) !== 0x02014b50) break;
      const method = buf.readUInt16LE(pos + 10);
      const compSize = buf.readUInt32LE(pos + 20);
      const nameLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const commentLen = buf.readUInt16LE(pos + 32);
      const localOffset = buf.readUInt32LE(pos + 42);
      const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
      pos += 46 + nameLen + extraLen + commentLen;
      if (localOffset + 30 > buf.length) continue;
      const localNameLen = buf.readUInt16LE(localOffset + 26);
      const localExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const rawSlice = buf.subarray(dataStart, dataStart + compSize);
      let data = null;
      try {
        if (method === 0) data = rawSlice;
        else if (method === 8) data = inflateRawSync(rawSlice);
      } catch {
        data = null; // one unreadable entry must not take the whole read down
      }
      entries.push({ name, method, data });
    }
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXmlEntities = (text) =>
  String(text).replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (all, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return XML_ENTITIES[entity] ?? all;
  });

const zipEntryText = (entry) => (entry?.data ? entry.data.toString("utf8") : "");

/**
 * The cell values of a workbook's first sheet, keyed by reference
 * (`{ E2: "270", F2: "30" }`) — a real XLSX read: the package's own
 * `xl/workbook.xml`, its relationships and the sheet part they name (with the
 * first worksheet as a fallback), the shared-string table when a cell indexes it
 * (`t="s"`), inline strings, numbers and booleans. null when the bytes hold no
 * readable sheet. Never a substring scan: a value is the cell's own value.
 */
export function readXlsxSheetCells(xlsxBytes) {
  const entries = readZipEntries(xlsxBytes);
  if (!entries) return null;
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const workbookText = zipEntryText(byName.get("xl/workbook.xml"));
  const relId = /<sheet\b[^>]*\sr:id="([^"]+)"/.exec(workbookText)?.[1] ?? "";
  let sheetPath = "";
  if (relId) {
    const rels = zipEntryText(byName.get("xl/_rels/workbook.xml.rels"));
    const target =
      new RegExp(`<Relationship\\b[^>]*\\bId="${relId}"[^>]*\\bTarget="([^"]+)"`, "i").exec(rels)?.[1] ??
      new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${relId}"`, "i").exec(rels)?.[1] ??
      "";
    if (target) {
      const normalized = target.replace(/^\//, "").replace(/^\.\//, "");
      sheetPath = normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
    }
  }
  if (!sheetPath || !byName.has(sheetPath)) {
    sheetPath = [...byName.keys()].filter((name) => /^xl\/worksheets\/[^/]+\.xml$/i.test(name)).sort()[0] ?? "";
  }
  if (!sheetPath) return null;
  const sheetText = zipEntryText(byName.get(sheetPath));
  if (!sheetText) return null;

  const sharedText = zipEntryText(byName.get("xl/sharedStrings.xml"));
  const sharedStrings = [...sharedText.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((si) =>
    [...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXmlEntities(t[1])).join(""),
  );

  const cells = new Map();
  // A self-closing <c r="A1"/> carries no value; dropping those first keeps the
  // open/close scan from swallowing the cells after one.
  for (const match of sheetText.replace(/<c\b[^>]*\/>/g, "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = match[1];
    const ref = /\br="([A-Za-z]+\d+)"/.exec(attrs)?.[1]?.toUpperCase() ?? "";
    if (!ref) continue;
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
    let value = "";
    if (type === "inlineStr") {
      value = [...match[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXmlEntities(t[1])).join("");
    } else {
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(match[2])?.[1];
      if (raw !== undefined) {
        value = type === "s" ? (sharedStrings[Number(raw)] ?? "") : decodeXmlEntities(raw);
      }
    }
    cells.set(ref, value);
  }
  return { sheetPath, cells };
}
