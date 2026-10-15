#!/usr/bin/env node
/* global fetch, AbortSignal, FormData, Blob, process, console, Buffer, URL, URLSearchParams, setTimeout */
// G7-10 P1 tracer loop driver (UNI-1379) — exit condition of P1.
//
// Runs the three end-to-end tracer loops on the synthetic fixtures through the
// G7-01 harness (`scripts/office/g5g6g7/harness/`), producing one evidence line
// per loop/AC when wrapped by `scripts/office/g5g6g7/evidence.mjs run`:
//
//   * Loop 1 (`--loop 1` / `xlsx-web-to-app`, G5-A03 / G6-A03, fx-xlsx-revenue-xyz):
//       X/Y/Z revenue XLSX opened on Web -> UniWork AI turn -> columns written in
//       the editor -> user Saves -> App receives the new version through the
//       workspace change feed (G5-01b/G5-02).
//   * Loop 2 (`--loop 2` / `docx-ai-save-app`, G6-A03 / G5-A03, fx-docx-report-vi):
//       DOCX edited by AI (proving the G6-A03 no-auto-save invariant: 0 server
//       versions and 0 save intents created by the AI turn itself) -> explicit
//       Save creates server version 2.
//   * Loop 3 (`--loop 3` / `docx-offline-save-app`, G5-A05, fx-docx-report-vi):
//       One offline Save in the App -> reconnect -> receipt (`version_id`,
//       `version`, `revision`) reconciles and settles in the app (`binding.json`).
//
// Hard rule on the AI part (`docs/office/g5g6g7/contract-p0.md` §8):
//   The cloud runner runs the D server with `AI_PROVIDER=fake` (no real model
//   upstream). Any segment whose claim requires a real model answer (accurate
//   X/Y/Z revenue columns from the model, or a real DOCX edit from the model)
//   is reported as `BLOCKED` (exit 77, reason
//   `"no real upstream on this runner; contract-p0 §8"`, owner `g7-qa`), NEVER
//   `PASS`, even when the fake provider returns 200. The deterministic mechanics
//   around it (0 versions created by the AI turn itself, deterministic editor
//   write -> Save -> server v2 -> workspace change feed -> commit-intent
//   reconciliation) are still driven and verified; any broken mechanic fails
//   with `FAIL` (exit 1), never `BLOCKED` (77).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

import {
  API_CALLS,
  API_PREFIX,
  ApiError,
} from "../harness/api-contract.mjs";
import {
  BLOCKED_EXIT as HARNESS_BLOCKED_EXIT,
  DEV_CLIENT_ID,
  HARNESS_DEPLOYMENT_ID,
  concludeAtStartGate,
  evidenceLine,
  fixtureSha256Of,
  handoffEnv,
  harnessEvidenceId,
  harnessPaths,
  ledgerIdentity,
  officeDeepLink,
  readStartStatus,
  setAppApiProxyOnline,
  startGate,
  workingCopyDir,
} from "../harness/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, "../../../..");
const MANIFEST_REL = "docs/office/g5g6g7/fixtures/manifest.json";

export const BLOCKED_EXIT = HARNESS_BLOCKED_EXIT;
export const UPSTREAM_BLOCKED_REASON = "no real upstream on this runner; contract-p0 §8";
export const UPSTREAM_BLOCKED_OWNER = "g7-qa";

export const WEB_SHEETS_HOST_SELECTOR = '[data-office-docs-frame][data-office-module="sheets"]';
export const WEB_SHEETS_READY_SELECTOR = '[data-office-docs-frame][data-office-module="sheets"][data-state="ready"]';
export const WEB_SHEETS_IFRAME_SELECTOR = 'iframe[src*="/office-frame/sheets/"]';

/**
 * Every HTTP route the tracer driver calls against the D server.
 * Path templates match `server/internal/handler/router/*.go` (under `/api/v1`).
 * Verified against the Go router and handler SDI structs in `tracer.test.mjs`.
 */
export const TRACER_API_CALLS = Object.freeze({
  ...API_CALLS,
  completeOnboarding: {
    method: "POST",
    path: "/me/onboarding/complete",
    sdi: "CompleteOnboardingSDI",
    body: ["completion_path", "workspace_id"],
  },
  getDesktopConsent: {
    method: "GET",
    path: "/auth/desktop/authorize",
  },
  submitDesktopConsent: {
    method: "POST",
    path: "/auth/desktop/authorize",
    sdi: "DesktopConsentSDI",
    body: ["attempt_id", "csrf_token", "decision"],
  },
  getDocument: {
    method: "GET",
    path: "/documents/{documentID}",
    params: { documentID: "id" },
  },
  listDocumentVersions: {
    method: "GET",
    path: "/documents/{documentID}/versions",
    params: { documentID: "id" },
  },
  uploadDocumentFile: {
    method: "POST",
    path: "/documents/{documentID}/uploads",
    params: { documentID: "id" },
    form: ["file"],
  },
  commitDocumentVersion: {
    method: "POST",
    path: "/documents/{documentID}/versions/commit",
    params: { documentID: "id" },
    sdi: "CommitDocumentVersionSDI",
    body: ["upload_id", "base_revision"],
  },
  lookupCommitIntent: {
    method: "GET",
    path: "/documents/{documentID}/versions/commit",
    params: { documentID: "id" },
  },
  listDocumentChanges: {
    method: "GET",
    path: "/workspaces/{workspaceID}/documents/changes",
    params: { workspaceID: "id" },
  },
  mintOfficeFrameToken: {
    method: "POST",
    path: "/documents/{documentID}/office/frame-token",
    params: { documentID: "id" },
  },
  openOfficeFrameDocument: {
    method: "GET",
    path: "/office-frame/documents/{documentID}",
    params: { documentID: "id" },
  },
  getOfficeFrameDocumentContent: {
    method: "GET",
    path: "/office-frame/documents/{documentID}/content",
    params: { documentID: "id" },
  },
  uploadOfficeFrameFile: {
    method: "POST",
    path: "/office-frame/documents/{documentID}/uploads",
    params: { documentID: "id" },
    form: ["file"],
  },
  commitOfficeFrameVersion: {
    method: "POST",
    path: "/office-frame/documents/{documentID}/versions/commit",
    params: { documentID: "id" },
    sdi: "CommitOfficeFrameVersionSDI",
    body: ["upload_id", "base_revision"],
  },
  aiUniworkFrameChatCompletions: {
    method: "POST",
    path: "/office-frame/documents/{documentID}/ai/uniwork/chat/completions",
    params: { documentID: "id" },
    sdi: "AiUniworkChatCompletionsSDI",
    body: ["messages"],
  },
  aiUniworkDocumentChatCompletions: {
    method: "POST",
    path: "/documents/{documentID}/ai/uniwork/chat/completions",
    params: { documentID: "id" },
    sdi: "AiUniworkChatCompletionsSDI",
    body: ["messages"],
  },
});

export function tracerApiPath(name, params = {}) {
  const call = TRACER_API_CALLS[name];
  if (!call) throw new Error(`unknown TRACER_API_CALLS entry "${name}"`);
  const wanted = Object.keys(call.params ?? {});
  const given = Object.keys(params);
  if (wanted.length !== given.length || wanted.some((key) => !(key in params))) {
    throw new Error(`API call ${name} takes path params {${wanted.join(", ")}}, got {${given.join(", ")}}`);
  }
  return API_PREFIX + call.path.replace(/\{(\w+)\}/g, (_, key) => {
    const val = params[key];
    if (typeof val !== "string" || val === "") {
      throw new Error(`${name}: missing path param {${key}}`);
    }
    return encodeURIComponent(val);
  });
}

export function assertTracerBodyKeys(name, body) {
  const call = TRACER_API_CALLS[name];
  if (!call) throw new Error(`unknown TRACER_API_CALLS entry "${name}"`);
  if (!call.body) return;
  const sent = Object.keys(body ?? {});
  const unknown = sent.filter((key) => !call.body.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${name}: body keys ${unknown.join(", ")} are not in contract table (${call.body.join(", ")})`);
  }
}

export function parseEnvFile(text) {
  return Object.fromEntries(
    String(text)
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        return at < 0 ? [line.trim(), ""] : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
}

export function checkDesktopPrecondition(portsEnv = {}) {
  if (!portsEnv.UNIWORK_USER_DATA || !portsEnv.ELECTRON_BIN || !portsEnv.SHELL_APP_DIR) {
    return {
      ok: false,
      reason:
        "this run did not start the fork app (no UNIWORK_USER_DATA/ELECTRON_BIN/SHELL_APP_DIR in ports.env; HARNESS_SKIP_APP=1)",
    };
  }
  const sessionBin = join(portsEnv.UNIWORK_USER_DATA, "uniwork-auth", "session.bin");
  if (!existsSync(sessionBin)) {
    return {
      ok: false,
      reason:
        "the app is not signed in (no uniwork-auth/session.bin; a headless Linux VM without an unlocked OS keyring cannot keep a desktop session)",
    };
  }
  return { ok: true, reason: "" };
}

/**
 * Lists encrypted `.rec` intent files in the fork's durable sync store:
 * `<userData>/uniwork-sync/store/<deploymentId>/<userId>/intents/*.rec`
 * (`apps/shell/src/main/uniwork-sync/store/paths.ts`, `intent-store.ts`).
 */
export function listAppSyncIntentFiles(userDataDir, deploymentId = HARNESS_DEPLOYMENT_ID, userId = "") {
  if (!userDataDir || !userId) return [];
  const intentsDir = join(userDataDir, "uniwork-sync", "store", deploymentId, userId, "intents");
  if (!existsSync(intentsDir)) return [];
  try {
    return readdirSync(intentsDir).filter((name) => name.endsWith(".rec"));
  } catch {
    return [];
  }
}

export function inspectWorkingCopy({
  userDataDir,
  deploymentId = HARNESS_DEPLOYMENT_ID,
  documentId,
  expectedUserId = null,
  expectedSha256 = "",
}) {
  const root = join(userDataDir, "uniwork-documents", deploymentId);
  if (!existsSync(root)) {
    return {
      bindingPresent: false,
      filePresent: false,
      sha256Match: false,
      bindingState: null,
      binding: null,
      workingCopyFilePath: null,
    };
  }
  const accounts = expectedUserId
    ? [expectedUserId]
    : readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

  for (const acc of accounts) {
    const dir = workingCopyDir(userDataDir, deploymentId, acc, documentId);
    const bindingPath = join(dir, "binding.json");
    if (!existsSync(bindingPath)) continue;
    try {
      const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
      const filePath = binding.filename ? join(dir, binding.filename) : null;
      const filePresent = Boolean(filePath && existsSync(filePath));
      const actualSha = filePresent ? sha256Hex(readFileSync(filePath)) : "";
      const sha256Match = expectedSha256 ? actualSha === expectedSha256 && binding.baseChecksum === expectedSha256 : true;
      return {
        bindingPresent: true,
        filePresent,
        sha256Match,
        bindingState: binding.state ?? null,
        bindingError: binding.error ?? null,
        binding,
        workingCopyFilePath: filePath,
      };
    } catch {
      return {
        bindingPresent: false,
        filePresent: false,
        sha256Match: false,
        bindingState: "invalid",
        binding: null,
        workingCopyFilePath: null,
      };
    }
  }
  return {
    bindingPresent: false,
    filePresent: false,
    sha256Match: false,
    bindingState: null,
    binding: null,
    workingCopyFilePath: null,
  };
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ---- Deterministic ZIP builder (matches make-fixtures.mjs) -------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const dosTime = (12 << 11) | (0 << 5) | 0;
  const dosDate = ((2026 - 1980) << 9) | (10 << 5) | 12;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const bodyBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const sum = crc32(bodyBuf);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(bodyBuf.length, 18);
    local.writeUInt32LE(bodyBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(bodyBuf.length, 20);
    central.writeUInt32LE(bodyBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    localParts.push(local, bodyBuf);
    centralParts.push(central);
    offset += local.length + bodyBuf.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function loadManifest(repoRoot = DEFAULT_REPO_ROOT) {
  return JSON.parse(readFileSync(join(repoRoot, MANIFEST_REL), "utf8"));
}

function loadVerifiedFixture(fixtureId, repoRoot = DEFAULT_REPO_ROOT) {
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
 * Deterministic v2 of `fx-xlsx-revenue-xyz.xlsx` with the X, Y, Z columns
 * written in the workbook.
 */
export function buildXlsxRevenueWithXyzBytes(repoRoot = DEFAULT_REPO_ROOT) {
  loadVerifiedFixture("fx-xlsx-revenue-xyz", repoRoot);
  const expectedXyz = [
    { region: "Miền Bắc", X: 270, Y: 30, Z: 0.25 },
    { region: "Miền Trung", X: 175, Y: 15, Z: 0.1875 },
    { region: "Miền Nam", X: 460, Y: 40, Z: 0.1905 },
  ];
  const bytes = buildStoredZip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Doanh thu" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>Khu vực</t></is></c>
      <c r="B1" t="inlineStr"><is><t>Sản phẩm</t></is></c>
      <c r="C1" t="inlineStr"><is><t>Q1</t></is></c>
      <c r="D1" t="inlineStr"><is><t>Q2</t></is></c>
      <c r="E1" t="inlineStr"><is><t>X (Tổng Q1+Q2)</t></is></c>
      <c r="F1" t="inlineStr"><is><t>Y (Chênh lệch Q2-Q1)</t></is></c>
      <c r="G1" t="inlineStr"><is><t>Z (Tỷ lệ tăng trưởng)</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>Miền Bắc</t></is></c>
      <c r="B2" t="inlineStr"><is><t>Gói Doanh nghiệp</t></is></c>
      <c r="C2"><v>120</v></c>
      <c r="D2"><v>150</v></c>
      <c r="E2"><v>${expectedXyz[0].X}</v></c>
      <c r="F2"><v>${expectedXyz[0].Y}</v></c>
      <c r="G2"><v>${expectedXyz[0].Z}</v></c>
    </row>
    <row r="3">
      <c r="A3" t="inlineStr"><is><t>Miền Trung</t></is></c>
      <c r="B3" t="inlineStr"><is><t>Gói Tiêu chuẩn</t></is></c>
      <c r="C3"><v>80</v></c>
      <c r="D3"><v>95</v></c>
      <c r="E3"><v>${expectedXyz[1].X}</v></c>
      <c r="F3"><v>${expectedXyz[1].Y}</v></c>
      <c r="G3"><v>${expectedXyz[1].Z}</v></c>
    </row>
    <row r="4">
      <c r="A4" t="inlineStr"><is><t>Miền Nam</t></is></c>
      <c r="B4" t="inlineStr"><is><t>Gói Doanh nghiệp</t></is></c>
      <c r="C4"><v>210</v></c>
      <c r="D4"><v>250</v></c>
      <c r="E4"><v>${expectedXyz[2].X}</v></c>
      <c r="F4"><v>${expectedXyz[2].Y}</v></c>
      <c r="G4"><v>${expectedXyz[2].Z}</v></c>
    </row>
  </sheetData>
</worksheet>`,
    },
  ]);
  return { bytes, sha256: sha256Hex(bytes), expectedXyz };
}

/**
 * The XML entries of a ZIP buffer, `{name, data}` per entry (supports both the
 * stored method 0 and the deflated method 8). null for a buffer that is not a
 * readable zip, so a caller can say why it read nothing.
 */
function readZipEntries(xlsxBytes) {
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

/**
 * The X, Y and Z columns `buildXlsxRevenueWithXyzBytes` builds and
 * `driveWebXlsxSave` types through the sheets name box: row 1 is the header
 * (`E1`/`F1`/`G1`), the three data rows are 2-4 and each expected row is read
 * from its own cells (`E2`/`F2`/`G2`, then `E3`/`F3`/`G3`, then `E4`/`F4`/`G4`).
 */
export const XYZ_COLUMNS = Object.freeze(["E", "F", "G"]);
export const XYZ_FIRST_DATA_ROW = 2;

/**
 * Whether the workbook carries the expected X, Y and Z values as cell values, by
 * reference and row (G710-BE-11). The old check concatenated every XML part and
 * matched `X` and `Y` as substrings anywhere in it — a style id, a shared string
 * or another column satisfied it, and `Z` was never read at all, although the
 * gate, the step text and the decision function all say X/Y/Z. Values are
 * compared as numbers (the editor writes `0.25`, a shared string may hold
 * `"0.25"`); a cell that is absent, blank or not the expected number fails.
 */
export function verifyXlsxContainsExpectedXyz(xlsxBytes, expectedXyz = []) {
  const sheet = readXlsxSheetCells(xlsxBytes);
  if (!sheet) return false;
  return expectedXyz.every((row, index) =>
    XYZ_COLUMNS.every((column, columnIndex) => {
      const cell = sheet.cells.get(`${column}${XYZ_FIRST_DATA_ROW + index}`);
      if (cell === undefined || String(cell).trim() === "") return false;
      const expected = [row?.X, row?.Y, row?.Z][columnIndex];
      if (expected === undefined || expected === null || expected === "") return false;
      return Number(cell) === Number(expected);
    }),
  );
}

/**
 * Matches a document version in a `GET /api/v1/workspaces/{id}/documents/changes`
 * response (`DocumentChangeListSDO`, `server/internal/handler/document_changes.go:42-70`,
 * `server/internal/handler/dto/sdo/document_changes.go:7-47`, `contract-p0.md` / spec §4.1).
 *
 * Snapshot rows (`changes[]`, `DocumentChangeSDO`) carry:
 *   `{ document_id, kind, revision, current_version, version_id }`
 * Feed rows (`feed[]`, `DocumentChangeFeedSDO`) carry:
 *   `{ document_id, change_kind, kind, revision, current_version, version_id, archived, removal }`
 * Neither SDO carries `version` or `checksum_sha256` (previously checked by r3 `tracer.mjs:2314`).
 */
export function matchDocumentVersionInChangeFeed(
  feedPages,
  { documentId, expectedVersion = 2, expectedVersionId = "", previousRevision = "" },
) {
  const pages = Array.isArray(feedPages) ? feedPages : [feedPages];
  for (const pageData of pages) {
    const items = [
      ...(Array.isArray(pageData?.changes) ? pageData.changes : []),
      ...(Array.isArray(pageData?.feed) ? pageData.feed : []),
    ];
    for (const item of items) {
      if (!item || item.document_id !== documentId) continue;
      if (item.change_kind && item.change_kind !== "upsert") continue;
      if (item.archived === true) continue;
      const itemVersion = Number(item.current_version ?? item.version ?? 0);
      if (itemVersion !== expectedVersion) continue;
      if (expectedVersionId && item.version_id && item.version_id !== expectedVersionId) continue;
      if (previousRevision && item.revision && String(item.revision) === String(previousRevision)) {
        continue;
      }
      return item;
    }
  }
  return null;
}

/**
 * Deterministic v2 of `fx-docx-report-vi.docx` with an edited Vietnamese
 * paragraph added.
 */
export function buildEditedDocxFixtureBytes(repoRoot = DEFAULT_REPO_ROOT) {
  const v1 = loadVerifiedFixture("fx-docx-report-vi", repoRoot);
  const v2Bytes = buildStoredZip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: "word/document.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>BÁO CÁO TIẾN ĐỘ QUÝ III — KHỐI SẢN PHẨM</w:t></w:r></w:p>
    <w:p><w:r><w:t>Tài liệu mẫu kiểm thử tiếng Việt cho quy trình đồng bộ và trợ lý AI của UniWork Office.</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Mục tiêu: đảm bảo lưu phiên bản rõ ràng, không tự động ghi đè khi chưa xác nhận.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Phạm vi: áp dụng cho tài liệu DOCX, bảng tính XLSX và bản trình chiếu PPTX.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Kết luận (cập nhật v2): hoàn thành mục tiêu doanh thu quý III và đồng bộ biên nhận phiên bản.</w:t></w:r></w:p>
  </w:body>
</w:document>`,
    },
  ]);
  return {
    v1Bytes: v1.bytes,
    v1Sha256: v1.sha256,
    v2Bytes,
    v2Sha256: sha256Hex(v2Bytes),
  };
}

// ---- HTTP transport ----------------------------------------------------------

async function callTracerApi({
  apiOrigin,
  fetchImpl = fetch,
  name,
  params = {},
  query = {},
  token,
  headers: extraHeaders = {},
  body,
  form,
  expectBinary = false,
  allowStatuses = [],
}) {
  const spec = TRACER_API_CALLS[name];
  if (!spec) throw new Error(`unknown TRACER_API_CALLS entry "${name}"`);
  const path = tracerApiPath(name, params);
  if (body !== undefined) assertTracerBodyKeys(name, body);

  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  }
  const qs = search.toString();
  const url = `${apiOrigin}${path}${qs ? `?${qs}` : ""}`;

  const headers = { ...extraHeaders };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetchImpl(url, {
    method: spec.method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(30_000),
  });

  if (expectBinary) {
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError({ method: spec.method, path, status: res.status, bodyText: text });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, bytes: buf };
  }

  const text = await res.text();
  if (!res.ok && !allowStatuses.includes(res.status)) {
    throw new ApiError({ method: spec.method, path, status: res.status, bodyText: text });
  }
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { rawText: text };
  }
  return { status: res.status, ok: res.ok, data: parsed };
}

async function seedFixtureDocument({
  apiOrigin,
  runDir = "",
  fetchImpl = fetch,
  fixtureId,
  repoRoot = DEFAULT_REPO_ROOT,
  now = Date.now(),
}) {
  const fixture = loadVerifiedFixture(fixtureId, repoRoot);
  const filename = basename(fixture.entry.path);
  const cachePath = runDir ? join(runDir, "g7-10-seeded-user.json") : "";

  if (cachePath && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf8"));
      if (
        cached &&
        cached.apiOrigin === apiOrigin &&
        cached.token &&
        cached.userId &&
        cached.organizationId &&
        cached.workspaceId
      ) {
        const form = new FormData();
        form.append("file", new Blob([fixture.bytes]), filename);
        form.append("title", filename);
        const docRes = await callTracerApi({
          apiOrigin,
          fetchImpl,
          name: "createFileDocument",
          params: { workspaceID: cached.workspaceId },
          token: cached.token,
          form,
        });
        return {
          ...cached,
          documentId: docRes.data.document.id,
          filename,
          fixture,
        };
      }
    } catch {
      // Cached account is stale or belongs to another server instance; seed a fresh one below.
    }
  }

  const stamp = `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `g7-10-tracer-${stamp}@example.com`;
  const password = "password123";

  const reg = await callTracerApi({
    apiOrigin,
    fetchImpl,
    name: "register",
    body: { email, password, display_name: "G7-10 tracer" },
  });
  const token = reg.data.access_token;
  const userId = reg.data.user?.id ?? null;

  await callTracerApi({
    apiOrigin,
    fetchImpl,
    name: "verifyEmail",
    token,
    body: { code: "123456" },
  });

  const organizationSlug = `o-g710-${stamp}`;
  const orgRes = await callTracerApi({
    apiOrigin,
    fetchImpl,
    name: "createOrganization",
    token,
    body: { name: "G7-10 tracer", slug: organizationSlug },
  });
  const organizationId = orgRes.data.organization.id;

  const workspaceSlug = `w-g710-${stamp}`;
  const wsRes = await callTracerApi({
    apiOrigin,
    fetchImpl,
    name: "createWorkspace",
    params: { org: organizationId },
    token,
    body: { name: "G7-10 tracer", slug: workspaceSlug },
  });
  const workspaceId = wsRes.data.workspace.id;

  // Complete onboarding so web navigation to /<org>/<ws>/documents/<id> never redirects to /onboarding (C2).
  await callTracerApi({
    apiOrigin,
    fetchImpl,
    name: "completeOnboarding",
    token,
    body: { completion_path: "full", workspace_id: workspaceId },
  });

  const accountRecord = {
    apiOrigin,
    email,
    password,
    token,
    userId,
    organizationId,
    organizationSlug: orgRes.data.organization?.slug ?? organizationSlug,
    workspaceId,
    workspaceSlug: wsRes.data.workspace?.slug ?? workspaceSlug,
  };
  if (cachePath) {
    try {
      mkdirSync(runDir, { recursive: true });
      writeFileSync(cachePath, `${JSON.stringify(accountRecord, null, 2)}\n`, { mode: 0o600 });
    } catch {
      // Best-effort cache for subsequent loops in the same runDir.
    }
  }

  const form = new FormData();
  form.append("file", new Blob([fixture.bytes]), filename);
  form.append("title", filename);
  const docRes = await callTracerApi({
    apiOrigin,
    fetchImpl,
    name: "createFileDocument",
    params: { workspaceID: workspaceId },
    token,
    form,
  });
  const documentId = docRes.data.document.id;

  return {
    ...accountRecord,
    documentId,
    filename,
    fixture,
  };
}

async function cleanupSeededOrganization({ apiOrigin, fetchImpl = fetch, seeded, runDir = "" }) {
  if (runDir) {
    try {
      rmSync(join(runDir, "g7-10-seeded-user.json"), { force: true });
    } catch {
      // ignore
    }
  }
  if (!seeded?.organizationId || !seeded?.organizationSlug || !seeded?.token) return;
  try {
    await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "requestOrganizationDeletion",
      params: { orgID: seeded.organizationId },
      token: seeded.token,
      body: { confirm_slug: seeded.organizationSlug },
    });
  } catch {
    // Best-effort cleanup so throwaway orgs do not accumulate on a real server.
  }
}

/**
 * Determines whether an AI chat completion response came from a genuine
 * upstream model with real X/Y/Z answers or from `AI_PROVIDER=fake` / disabled.
 * Under `contract-p0.md` §8 and spec §12.3 (C4), the cloud runner runs `AI_PROVIDER=fake`
 * (or answers 503 `ai_disabled` when the fake deployment has AI disabled) and must
 * report `BLOCKED` (exit 77, owner `g7-qa`, reason `UPSTREAM_BLOCKED_REASON`), NEVER `PASS` or `FAIL`.
 */
export function classifyAiResponse(aiTurnResult, expectedXyz = null, options = {}) {
  if (!aiTurnResult.ok) {
    return {
      status: "BLOCKED",
      reason: UPSTREAM_BLOCKED_REASON,
      owner: UPSTREAM_BLOCKED_OWNER,
      httpStatus: aiTurnResult.status,
      errorCode: aiTurnResult.data?.error?.code ?? "http_error",
    };
  }
  const provider = String(aiTurnResult.data?.provider ?? "");
  const model = String(aiTurnResult.data?.model ?? "");
  const content = String(aiTurnResult.data?.choices?.[0]?.message?.content ?? "");
  const allowReal = Boolean(
    options?.allowRealUpstream ?? (process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM === "1"),
  );

  if (
    !allowReal ||
    process.env.AI_PROVIDER === "fake" ||
    provider === "fake" ||
    model.includes("fake") ||
    content.includes("[fake")
  ) {
    return {
      status: "BLOCKED",
      reason: UPSTREAM_BLOCKED_REASON,
      owner: UPSTREAM_BLOCKED_OWNER,
      httpStatus: aiTurnResult.status,
      provider: provider || "fake",
    };
  }
  if (expectedXyz) {
    for (const row of expectedXyz) {
      if (!content.includes(String(row.X)) || !content.includes(String(row.Y))) {
        return {
          status: "FAIL",
          reason: `real AI upstream response did not contain expected X/Y/Z values for ${row.region}`,
          httpStatus: aiTurnResult.status,
        };
      }
    }
  }
  return { status: "PASS", httpStatus: aiTurnResult.status };
}

/**
 * Interprets the response from `GET /api/v1/documents/{id}/versions/commit`
 * (`lookupCommitIntent`) per the G5-07 contract (`server/internal/service/document_commit_intent.go:193-197, 418-441`,
 * `server/internal/handler/dto/sdo/document.go:125-135`, `docs/office/g5g6g7/contract-p0.md:89, 126`, C3):
 *   * HTTP 410 `commit_intent_unknown` (`error.fields.outcome === "unknown"`):
 *     the server holds no row for that `Idempotency-Key` (never claimed, or swept after TTL).
 *   * HTTP 200 `{ outcome: "not_committed" }`: a claim row existed and expired without committing.
 *   * HTTP 200 `{ outcome: "in_flight" }`: a claim row is currently live in flight.
 *   * HTTP 200 `{ outcome: "committed", version_id, version, revision }`: committed receipt.
 */
export function interpretCommitIntentLookup(res) {
  const status = Number(res?.status ?? 0);
  const data = res?.data ?? {};
  if (status === 410) {
    const code = data?.error?.code ?? "commit_intent_unknown";
    const outcome = data?.error?.fields?.outcome ?? "unknown";
    return {
      httpStatus: 410,
      code,
      outcome,
      hasCommitted: false,
      hasClaim: false,
    };
  }
  const outcome = data?.outcome ?? "unknown";
  if (outcome === "committed") {
    return {
      httpStatus: status,
      code: null,
      outcome: "committed",
      hasCommitted: true,
      hasClaim: true,
      versionId: data?.version_id ?? null,
      version: data?.version ?? null,
      revision: data?.revision ?? null,
    };
  }
  return {
    httpStatus: status,
    code: null,
    outcome,
    hasCommitted: false,
    hasClaim: outcome === "not_committed" || outcome === "in_flight",
  };
}

// ---- Pure Outcome Decision Functions (G710-L1, G710-L2, G710-L3, r3) ---------

/**
 * Pure decision function for desktop app sign-in (r3, ADDENDUM r5 G1/G3):
 *   * `appStarted: false` — the run never started the fork app (`HARNESS_SKIP_APP=1`,
 *     or a ports.env without `UNIWORK_USER_DATA`/`ELECTRON_BIN`/`SHELL_APP_DIR`) —
 *     is a step that cannot be driven by design: `BLOCKED` (exit 77).
 *   * Once start.sh reported the app up, every way the app can be missing is a
 *     harness or app failure, never a missing precondition: `FAIL` (exit 1) when
 *     the recorded app process is gone (`appProcessAlive === false`), when a CDP
 *     connection was attempted and refused, and when CDP answered but no shell
 *     renderer window exposing `window.aiOffice` was found. Cloud round r3 read
 *     exactly those three as BLOCKED, and the round passed with a false BLOCKED.
 *   * A CDP connection that was never possible (no `APP_CDP_PORT`, no Playwright)
 *     keeps `BLOCKED`: the app cannot be driven headlessly in this run dir.
 *   * The OS keyring being unavailable or locked (`keyringAvailable === false`, or
 *     `accountState` `"keyring-unavailable"` / `"keystore-locked"`) is the other
 *     precondition the VM may genuinely lack: `BLOCKED` (exit 77).
 *   * With a usable keyring, self sign-in must leave BOTH `accountState ===
 *     "signed-in"` (for `expectedUserId`) AND `uniwork-auth/session.bin` on disk
 *     (`sessionBinExists === true`); any failure returns `FAIL` (exit 1).
 *
 * `appProcessAlive` and `keyringAvailable` are tri-state: `null` means the tracer
 * never learned the fact (no pid file / no `accountStatus` read), which is not the
 * same statement as `false` (G3 — the r3 record said `keyringAvailable: false`
 * next to `sessionBinExists: true` on a path that never asked the app).
 */
export function decideAppSignInOutcome({
  appStarted = true,
  appPid = null,
  appProcessAlive = null,
  cdpAttempted = false,
  cdpConnected = true,
  shellWindowFound = null,
  keyringAvailable = null,
  accountState = "unknown",
  sessionBinExists = false,
  signedInUserId = "",
  expectedUserId = "",
  signInError = "",
  blockerReason = "",
}) {
  const appRef = appPid === null || appPid === undefined ? "the pid start.sh recorded" : `pid ${appPid}`;
  if (!appStarted) {
    return {
      exitCode: BLOCKED_EXIT,
      status: "BLOCKED",
      signedIn: false,
      reason:
        blockerReason ||
        "this run did not start the fork app (no UNIWORK_USER_DATA/ELECTRON_BIN/SHELL_APP_DIR in ports.env; HARNESS_SKIP_APP=1)",
    };
  }
  if (appProcessAlive === false) {
    return {
      exitCode: 1,
      status: "FAIL",
      signedIn: false,
      reason: `start.sh reported the app started, but its process is gone at loop start (${appRef}; the run dir's pids file records it, see the run's logs/app.log)${blockerReason ? `; last CDP error: ${blockerReason}` : ""}`,
    };
  }
  if (cdpAttempted && !cdpConnected) {
    return {
      exitCode: 1,
      status: "FAIL",
      signedIn: false,
      reason:
        blockerReason ||
        `the app was started (${appRef} is alive) but its CDP endpoint did not answer; a harness or app failure, not a missing precondition`,
    };
  }
  if (cdpConnected && shellWindowFound === false) {
    return {
      exitCode: 1,
      status: "FAIL",
      signedIn: false,
      reason:
        blockerReason ||
        "connected to Electron CDP but found no shell renderer window exposing window.aiOffice",
    };
  }
  if (!cdpConnected) {
    return {
      exitCode: BLOCKED_EXIT,
      status: "BLOCKED",
      signedIn: false,
      reason:
        blockerReason ||
        "the app's Save cannot be driven headlessly in this run (no CDP connection is possible; ports.env has no APP_CDP_PORT or Playwright is not loadable)",
    };
  }
  if (keyringAvailable === false || accountState === "keyring-unavailable" || accountState === "keystore-locked") {
    return {
      exitCode: BLOCKED_EXIT,
      status: "BLOCKED",
      signedIn: false,
      reason:
        blockerReason ||
        `the app is not signed in (accountStatus.state=${accountState}, no uniwork-auth/session.bin; a headless Linux VM without an unlocked OS keyring cannot keep a desktop session)`,
    };
  }
  if (signInError) {
    return {
      exitCode: 1,
      status: "FAIL",
      signedIn: false,
      reason: `desktop app sign-in failed while the OS keyring was available: ${signInError}`,
    };
  }
  if (accountState !== "signed-in") {
    return {
      exitCode: 1,
      status: "FAIL",
      signedIn: false,
      reason: `desktop app sign-in did not reach accountStatus.state="signed-in" while the OS keyring was available (got state="${accountState}")`,
    };
  }
  if (!sessionBinExists) {
    return {
      exitCode: 1,
      status: "FAIL",
      signedIn: false,
      reason:
        'desktop app reported accountStatus.state="signed-in" while the OS keyring was available, but uniwork-auth/session.bin was not written to disk',
    };
  }
  if (expectedUserId && signedInUserId && signedInUserId !== expectedUserId) {
    return {
      exitCode: 1,
      status: "FAIL",
      signedIn: false,
      reason: `desktop app signed in as ${signedInUserId}, expected seeded user ${expectedUserId}`,
    };
  }
  return {
    exitCode: 0,
    status: "PASS",
    signedIn: true,
    reason: "desktop app is signed in with uniwork-auth/session.bin on disk",
  };
}

/**
 * Pure outcome decision for Loop 1 (`fx-xlsx-revenue-xyz`: web open -> AI turn ->
 * editor X/Y/Z save -> workspace change feed -> app reloads v2).
 *
 * Hard rules (G710-L1, G710-L3, r3):
 *   * Any protocol-only step (`webSaveSource === "protocol"` or
 *     `appObservedV2Source === "protocol"`) NEVER lets the loop `PASS`.
 *   * A G6-A03 violation (AI turn creating a version) or missing change-feed v2
 *     is always `FAIL` (exit 1).
 *   * If the OS keyring was available and app sign-in failed (`appSignInFailureReason`),
 *     the loop is `FAIL` (exit 1) with that reason.
 *   * If the live web UI was driven and failed (`webUiError`), the loop is `FAIL` (exit 1).
 *   * If the app was signed in and driven (`appSignedIn && appDriven`) yet did
 *     not reload v2 (`!appObservedV2ViaFeed`), the loop is `FAIL` (exit 1).
 *   * Under `AI_PROVIDER=fake` (`!aiRealUpstream`), without a driven web UI
 *     (`!webUiDriven`), or without a signed-in driven app (`!appSignedIn || !appDriven`),
 *     the loop is `BLOCKED` (exit 77, owner `g7-qa`).
 */
export function decideLoop1Outcome({
  versionsBeforeTurn,
  versionsAfterTurn,
  versionsAfterSave,
  v2ContainsExpectedXyz = true,
  changeFeedDeliveredV2,
  aiRealUpstream,
  aiFailureReason = "",
  webUiDriven,
  webSaveSource,
  webUiError = "",
  appSignedIn,
  appDriven,
  appOpenedV1 = false,
  appObservedV2ViaFeed = false,
  appObservedV2Source = "protocol",
  appSignInFailureReason = "",
  desktopBlockReason = "",
}) {
  if (versionsAfterTurn !== versionsBeforeTurn) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `G6-A03 violation: AI turn created a server version before user Save (versions ${versionsBeforeTurn} -> ${versionsAfterTurn})`,
    };
  }
  if (aiFailureReason) {
    return { exitCode: 1, status: "FAIL", owner: UPSTREAM_BLOCKED_OWNER, reason: aiFailureReason };
  }
  if (versionsAfterSave !== versionsBeforeTurn + 1) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `expected ${versionsBeforeTurn + 1} versions after Save, got ${versionsAfterSave}`,
    };
  }
  if (!v2ContainsExpectedXyz) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: "committed v2 workbook bytes do not contain the expected X/Y/Z values",
    };
  }
  if (!changeFeedDeliveredV2) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: "workspace change feed did not report v2 after Save",
    };
  }
  if (appSignInFailureReason) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: appSignInFailureReason,
    };
  }
  if (webUiError) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `web UI failed while driving ${WEB_SHEETS_HOST_SELECTOR}: ${webUiError}`,
    };
  }
  if (appSignedIn && appDriven && (!appOpenedV1 || !appObservedV2ViaFeed || appObservedV2Source !== "app")) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `signed-in desktop app did not reload v2 from the workspace change feed into binding.json (appOpenedV1=${appOpenedV1}, appObservedV2ViaFeed=${appObservedV2ViaFeed}, source=${appObservedV2Source})`,
    };
  }
  if (!aiRealUpstream) {
    return {
      exitCode: BLOCKED_EXIT,
      status: "BLOCKED",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `${UPSTREAM_BLOCKED_REASON}; 0-version AI turn invariant (${versionsBeforeTurn}->${versionsAfterTurn}) and v2 change-feed delivery verified`,
    };
  }
  if (!webUiDriven || webSaveSource !== "web") {
    return {
      exitCode: BLOCKED_EXIT,
      status: "BLOCKED",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason:
        "web UI editor save was not driven through Playwright on WEB_ORIGIN (protocol-only evidence cannot PASS Loop 1; G710-L1)",
    };
  }
  if (!appSignedIn || !appDriven || !appObservedV2ViaFeed || appObservedV2Source !== "app") {
    return {
      exitCode: BLOCKED_EXIT,
      status: "BLOCKED",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason:
        desktopBlockReason ||
        "the desktop app is not signed in or could not be driven headlessly to observe the workspace change-feed v2 reload in binding.json (G710-L3)",
    };
  }
  return {
    exitCode: 0,
    status: "PASS",
    owner: UPSTREAM_BLOCKED_OWNER,
    reason: "Loop 1 passed end to end across web UI, workspace change feed, and desktop app binding.json",
  };
}

/**
 * Pure outcome decision for Loop 2 (`fx-docx-report-vi`: AI edit turn creates 0
 * versions and 0 save intents -> explicit Save in the app creates v2).
 */
export function decideLoop2Outcome({
  versionsBeforeTurn,
  versionsAfterTurn,
  versionsAfterSave,
  commitIntentOutcome,
  aiRealUpstream,
  aiFailureReason = "",
  appSignedIn,
  appDriven,
  appOpenedV1 = false,
  appIntentsAfterTurn = 0,
  appSavedV2 = false,
  saveSource = "protocol",
  appSignInFailureReason = "",
  desktopBlockReason = "",
}) {
  if (versionsAfterTurn !== versionsBeforeTurn || appIntentsAfterTurn > 0) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `G6-A03 violation: AI turn created a server version or queued an app save intent before explicit Save (versions ${versionsBeforeTurn} -> ${versionsAfterTurn}, appIntentsAfterTurn=${appIntentsAfterTurn})`,
    };
  }
  if (aiFailureReason) {
    return { exitCode: 1, status: "FAIL", owner: UPSTREAM_BLOCKED_OWNER, reason: aiFailureReason };
  }
  if (versionsAfterSave !== versionsBeforeTurn + 1 || commitIntentOutcome !== "committed") {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `expected versionsAfterSave=${versionsBeforeTurn + 1} and commitIntentOutcome=committed, got versions=${versionsAfterSave}, outcome=${commitIntentOutcome}`,
    };
  }
  if (appSignInFailureReason) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: appSignInFailureReason,
    };
  }
  if (appSignedIn && appDriven && (!appOpenedV1 || !appSavedV2 || saveSource !== "app")) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `signed-in desktop app failed to save v2 and update binding.json (appOpenedV1=${appOpenedV1}, appSavedV2=${appSavedV2}, saveSource=${saveSource})`,
    };
  }
  if (!aiRealUpstream) {
    return {
      exitCode: BLOCKED_EXIT,
      status: "BLOCKED",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `${UPSTREAM_BLOCKED_REASON}; G6-A03 no-auto-save invariant (versionsBefore=${versionsBeforeTurn}, versionsAfterTurn=${versionsAfterTurn}) verified`,
    };
  }
  if (!appSignedIn || !appDriven || !appSavedV2 || saveSource !== "app") {
    return {
      exitCode: BLOCKED_EXIT,
      status: "BLOCKED",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason:
        desktopBlockReason ||
        "the desktop app is not signed in or its Save could not be driven headlessly (protocol-only evidence cannot PASS Loop 2; G710-L1)",
    };
  }
  return {
    exitCode: 0,
    status: "PASS",
    owner: UPSTREAM_BLOCKED_OWNER,
    reason: "Loop 2 passed end to end: 0 versions/intents on AI turn, v2 committed by explicit app Save",
  };
}

/**
 * Pure outcome decision for Loop 3 (`fx-docx-report-vi`: app opens v1 -> link to
 * D server cut -> app Saves while cut and holds offline state/intent while server
 * stays at v1 -> link resumed -> app flushes save and settles `binding.json` at v2).
 *
 * Hard rule (G710-L2):
 *   If the test itself committed v2 over HTTP before the app opened the document
 *   (`testCommittedBeforeApp === true` or `commitSource === "protocol"` while
 *   claiming an app receipt), the outcome is `FAIL` (exit 1), NEVER `PASS`.
 */
export function decideLoop3Outcome({
  appSignedIn,
  appDriven,
  appOpenedV1,
  appHeldOfflineIntentWhileCut,
  serverVersionsWhileCut,
  testCommittedBeforeApp = false,
  commitSource = "protocol",
  appBindingAfterReconnect = null,
  appIntentsAfterReconnect = 0,
  serverVersionsAfterReconnect = 1,
  appSignInFailureReason = "",
  desktopBlockReason = "",
}) {
  if (appSignInFailureReason) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: appSignInFailureReason,
    };
  }
  if (testCommittedBeforeApp || (appDriven && commitSource === "protocol")) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason:
        "G710-L2 violation: test committed v2 over protocol HTTP before the app opened or saved; binding.json at v2 only proves the app opened v2, not an offline save",
    };
  }
  if (
    appBindingAfterReconnect &&
    (appBindingAfterReconnect.state === "conflict" || appBindingAfterReconnect.state === "error")
  ) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `binding.json settled to ${appBindingAfterReconnect.state} (${appBindingAfterReconnect.error ?? "unknown"}) instead of saved v2 receipt`,
    };
  }
  if (!appSignedIn) {
    return {
      exitCode: BLOCKED_EXIT,
      status: "BLOCKED",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason:
        desktopBlockReason ||
        "the app is not signed in (no uniwork-auth/session.bin; a headless Linux VM without an unlocked OS keyring cannot keep a desktop session)",
    };
  }
  if (!appDriven) {
    return {
      exitCode: BLOCKED_EXIT,
      status: "BLOCKED",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason:
        desktopBlockReason ||
        "the app's Save cannot be driven headlessly in this run (no CDP connection to the running Electron shell)",
    };
  }
  if (!appOpenedV1) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: "the app did not open v1 (binding.json baseVersion=1) before the offline Save",
    };
  }
  if (serverVersionsWhileCut !== 1) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `expected server to still have 1 version while the app's proxy link was cut, got ${serverVersionsWhileCut}`,
    };
  }
  if (!appHeldOfflineIntentWhileCut) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason:
        "the app did not record an offline save state (binding.json state=offline or uniwork-sync/store/.../intents/*.rec) while its proxy link to the D server was cut",
    };
  }
  if (
    commitSource !== "app" ||
    !appBindingAfterReconnect ||
    appBindingAfterReconnect.state !== "saved" ||
    Number(appBindingAfterReconnect.baseVersion ?? 0) !== 2 ||
    serverVersionsAfterReconnect !== 2 ||
    appIntentsAfterReconnect !== 0
  ) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `after reconnect, app did not settle to saved v2 receipt with 1 server commit and 0 remaining intents (state=${appBindingAfterReconnect?.state ?? "none"}, baseVersion=${appBindingAfterReconnect?.baseVersion ?? "none"}, serverVersions=${serverVersionsAfterReconnect}, intentsRemaining=${appIntentsAfterReconnect})`,
    };
  }
  return {
    exitCode: 0,
    status: "PASS",
    owner: UPSTREAM_BLOCKED_OWNER,
    reason: "Loop 3 passed: app opened v1, held offline save intent while cut (server at v1), and settled binding.json to v2 saved receipt on reconnect",
  };
}

// ---- Real Web UI (Playwright) and Real Electron App (CDP + Proxy) Drivers ----

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * The pid start.sh recorded for the app, and whether that process is alive right
 * now (G1). start.sh writes `<name> <pid> <port>` per line into the run dir's
 * `pids` file and stops exactly those groups; the app line is the last word on
 * whether the app the harness started is still there. `null` means unknown (no
 * pid file, or no app line in it) and is never treated as dead: only a pid that
 * is recorded and gone is evidence of a failure.
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return null;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    // EPERM means the process exists and belongs to somebody else.
    return err?.code === "EPERM";
  }
}

export function readAppProcessRecord(runDir) {
  if (!runDir) return { appPid: null, appProcessAlive: null, appProcessSource: "no-pid-file" };
  const pidFile = join(runDir, "pids");
  if (!existsSync(pidFile)) return { appPid: null, appProcessAlive: null, appProcessSource: "no-pid-file" };
  let appPid = null;
  try {
    for (const line of readFileSync(pidFile, "utf8").split("\n")) {
      const [name, pid] = line.trim().split(/\s+/);
      if (name === "app" && Number.isInteger(Number(pid))) appPid = Number(pid);
    }
  } catch {
    return { appPid: null, appProcessAlive: null, appProcessSource: "unreadable-pid-file" };
  }
  if (appPid === null) return { appPid: null, appProcessAlive: null, appProcessSource: "no-app-line" };
  return { appPid, appProcessAlive: isProcessAlive(appPid), appProcessSource: "pid-file" };
}

/**
 * What a sign-in error may say in `tracer-loop-N.json` (G710-BE-13). The field
 * is an open channel — the sign-in flow passes a consent callback URL around,
 * and a future error string can embed a token or a credential — so everything
 * that could carry one is dropped and the error class/context is kept:
 *
 *   * a URL becomes `<url>`: its query (a single-use `code`/`state`), its
 *     userinfo and its path go with it;
 *   * a `key=value`/`key: value` pair whose key names a credential or a session
 *     keeps the key and loses the value;
 *   * a bare `Bearer`/`Basic` credential is replaced;
 *   * a long opaque run (32+ characters of token alphabet) is replaced;
 *   * the whole message is truncated.
 */
export const SIGN_IN_ERROR_MAX_CHARS = 240;
const SIGN_IN_ERROR_KEY_VALUE =
  /(?<=\b(?:access_token|refresh_token|id_token|token|secret|password|passwd|credential|credentials|authorization|api_?key|csrf_?token|csrf|ticket|attempt_id|code|state)\s*[:=]\s*)[^\s,;&"']+/gi;
const SIGN_IN_ERROR_OPAQUE = /[A-Za-z0-9_-]{32,}/g;

export function redactSignInError(raw) {
  let text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>");
  text = text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, (match, scheme) => `${scheme} <redacted>`);
  text = text.replace(SIGN_IN_ERROR_KEY_VALUE, "<redacted>");
  text = text.replace(SIGN_IN_ERROR_OPAQUE, "<redacted>");
  return text.length > SIGN_IN_ERROR_MAX_CHARS ? `${text.slice(0, SIGN_IN_ERROR_MAX_CHARS)}...` : text;
}

export const DEFAULT_APP_STEP_TIMEOUT_MS = 90_000;
export const DEFAULT_LOOP_TIMEOUT_MS = 600_000;
const APP_LOG_TAIL_LINES = 40;

export function resolveAppStepTimeoutMs(overrideMs, portsEnv = null) {
  if (Number.isFinite(Number(overrideMs)) && Number(overrideMs) > 0) {
    return Number(overrideMs);
  }
  const fromEnv = Number(process.env.HARNESS_APP_STEP_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const fromPorts = Number(portsEnv?.HARNESS_APP_STEP_TIMEOUT_MS);
  if (Number.isFinite(fromPorts) && fromPorts > 0) return fromPorts;
  return DEFAULT_APP_STEP_TIMEOUT_MS;
}

export function resolveLoopTimeoutMs(overrideMs, portsEnv = null) {
  if (Number.isFinite(Number(overrideMs)) && Number(overrideMs) > 0) {
    return Number(overrideMs);
  }
  const fromEnv = Number(process.env.HARNESS_LOOP_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const fromPorts = Number(portsEnv?.HARNESS_LOOP_TIMEOUT_MS);
  if (Number.isFinite(fromPorts) && fromPorts > 0) return fromPorts;
  return DEFAULT_LOOP_TIMEOUT_MS;
}

export function formatAppStepTimeoutReason(call, timeoutMs) {
  const seconds = Number((Number(timeoutMs) / 1000).toFixed(3));
  return `${call} did not settle within ${seconds} s`;
}

export function formatDocsTabReadyTimeoutReason(timeoutMs) {
  const seconds = Number((Number(timeoutMs) / 1000).toFixed(3));
  return `docs tab not ready to close within ${seconds} s`;
}

function sanitizeTargetUrl(rawUrl) {
  const text = String(rawUrl ?? "").trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    const safeParams = new URLSearchParams();
    for (const [k, v] of parsed.searchParams.entries()) {
      if (k === "mode") {
        safeParams.set(k, v);
      } else {
        safeParams.set(k, "<redacted>");
      }
    }
    const qs = safeParams.toString();
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${qs ? `?${qs}` : ""}`;
  } catch {
    return redactSignInError(text);
  }
}

export function readRedactedAppLogTail(runDir, maxLines = APP_LOG_TAIL_LINES) {
  if (!runDir) return [];
  const appLogPath = join(runDir, "logs", "app.log");
  if (!existsSync(appLogPath)) return [];
  try {
    const raw = readFileSync(appLogPath, "utf8");
    const lines = raw.split(/\r?\n/);
    if (lines.length > 0 && lines.at(-1) === "") lines.pop();
    return lines.slice(-maxLines).map((line) => redactSignInError(line));
  } catch {
    return [];
  }
}

function readBindingSnapshotAtTimeout({
  userDataDir,
  deploymentId = HARNESS_DEPLOYMENT_ID,
  documentId,
  expectedUserId,
}) {
  if (!userDataDir || !documentId) {
    return { bindingState: null, binding: null };
  }
  try {
    const wc = inspectWorkingCopy({
      userDataDir,
      deploymentId,
      documentId,
      expectedUserId,
    });
    if (!wc.bindingPresent || !wc.binding) {
      return { bindingState: null, binding: null };
    }
    return {
      bindingState: wc.bindingState ?? wc.binding?.state ?? null,
      binding: {
        state: wc.binding?.state ?? null,
        baseVersion: wc.binding?.baseVersion ?? null,
        baseRevision: wc.binding?.baseRevision ?? null,
        baseVersionId: wc.binding?.baseVersionId ?? null,
        baseChecksum: wc.binding?.baseChecksum ?? null,
        error: wc.binding?.error ? redactSignInError(wc.binding.error) : null,
      },
    };
  } catch {
    return { bindingState: null, binding: null };
  }
}

/**
 * Runs an app-side CDP call (`connect`, `page.evaluate` of `window.aiOffice.*`,
 * `aiOfficeTabs.close`, etc.) under a bounded race (`HARNESS_APP_STEP_TIMEOUT_MS`,
 * default 90000 ms). On timeout, throws an Error with `isAppStepTimeout = true`
 * and `appStepTimeout` diagnostics (`call`, `elapsedMs`, `bindingState`, `binding`,
 * `appLogTail`).
 */
export async function runBoundedAppStep(
  call,
  fn,
  {
    timeoutMs,
    portsEnv = null,
    runDir = null,
    userDataDir = null,
    deploymentId = HARNESS_DEPLOYMENT_ID,
    documentId = null,
    expectedUserId = null,
  } = {},
) {
  const boundMs = resolveAppStepTimeoutMs(timeoutMs, portsEnv);
  const startedAt = Date.now();
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const elapsedMs = Math.max(boundMs, Date.now() - startedAt);
          const reason = formatAppStepTimeoutReason(call, boundMs);
          const { bindingState, binding } = readBindingSnapshotAtTimeout({
            userDataDir: userDataDir ?? portsEnv?.UNIWORK_USER_DATA ?? null,
            deploymentId,
            documentId,
            expectedUserId,
          });
          const appLogTail = readRedactedAppLogTail(runDir, APP_LOG_TAIL_LINES);
          const err = new Error(reason);
          err.isAppStepTimeout = true;
          err.appStepTimeout = {
            call,
            timeoutMs: boundMs,
            elapsedMs,
            reason,
            bindingState,
            binding,
            appLogTail,
          };
          reject(err);
        }, boundMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * Waits (bounded by `HARNESS_APP_STEP_TIMEOUT_MS`) until the open docs tab's
 * `WebContentsView` renderer is ready to answer `docsQueryDirty`'s
 * `'docs:close-check'` IPC (`apps/docs/src/main/docs-main.ts:6288-6308`) before
 * `aiOfficeTabs.close` is called (Finding H2).
 *
 * Fork root cause (`ab12238f`):
 *   - `TabManager.closeTab` -> `confirmTabClose` (`apps/shell/src/main/tab-manager.ts:893-929`)
 *     calls `docsQueryDirty` (`apps/docs/src/main/docs-main.ts:6288-6308`), which sends
 *     `wc.send('docs:close-check')` (`docs-main.ts:6300`) and waits 2 s (`docs-main.ts:6293`).
 *   - If the docs renderer (`genoffice-app://docs/index.html?mode=tab`,
 *     `apps/docs/src/main/docs-main.ts:6425`) has not finished `loadFile(pending)`
 *     (`apps/docs/src/renderer/App.tsx:2242-2256`) and mounted its close-guard
 *     `useEffect` (`window.desktop.onCloseCheck`, `App.tsx:5334-5362`), `docsQueryDirty`
 *     fails closed with `{ dirty: true, autoSave: false, unresponsive: true }`
 *     (`docs-main.ts:6295`) and `performDocsClose` (`docs-main.ts:6355-6376`) opens
 *     a native `dialog.showMessageBox` (`closeNoReplyMsg`: Close Anyway / Cancel) on
 *     the headless Xvfb display where nothing clicks it.
 *
 * Positive readiness signal on the docs `WebContentsView` target:
 *   1. `document.readyState === "complete"`
 *   2. `typeof window.desktop?.onCloseCheck === "function"` and
 *      `typeof window.desktop?.reportCloseCheck === "function"`
 *      (`apps/docs/src/preload/index.ts:246-261,277`)
 *   3. `!document.querySelector(".start-booting")` (`apps/docs/src/renderer/App.tsx:7519`
 *      while `doc === null`; `<EditorContent editor={editor} />` at `App.tsx:7438` once
 *      `doc !== null`)
 *   4. `window.__genofficeControl({ cmd: "selection" })?.status === "ok"` and
 *      `Boolean(window.__aidocs?.editor)` (`apps/docs/src/renderer/App.tsx:6198-6215`,
 *      `apps/docs/src/renderer/control.ts:16-21`, which commits after the `onCloseCheck`
 *      effect at `App.tsx:5334-5362` and returns `status: "ok"` only when `editor` and
 *      `doc !== null` are both ready).
 *   5. Calls `window.desktop.reportCloseCheck({ dirty: false, autoSave: false, filePath })`
 *      to flush any pre-mount waiter in `closeCheckWaiters` (`docs-main.ts:6259-6273`)
 *      from the shell's 1 s `editor-state-poll.ts` (`editor-state-poll.ts:56-84`).
 */
export async function waitForDocsTabReadyToClose({
  browser,
  shellPage = null,
  filePath = null,
  timeoutMs,
  portsEnv = null,
  runDir = null,
  userDataDir = null,
  deploymentId = HARNESS_DEPLOYMENT_ID,
  documentId = null,
  expectedUserId = null,
  pollIntervalMs = 50,
} = {}) {
  const boundMs = resolveAppStepTimeoutMs(timeoutMs, portsEnv);
  const startedAt = Date.now();
  const deadline = startedAt + boundMs;
  let lastTargetUrl = null;

  while (Date.now() < deadline) {
    const contexts = typeof browser?.contexts === "function" ? browser.contexts() : [];
    for (const ctx of contexts) {
      const pages = typeof ctx?.pages === "function" ? ctx.pages() : [];
      for (const candidate of pages) {
        if (!candidate || candidate === shellPage) continue;
        let rawUrl = "";
        try {
          rawUrl = typeof candidate.url === "function" ? String(candidate.url() ?? "") : "";
        } catch {
          rawUrl = "";
        }
        if (rawUrl && (rawUrl.includes("docs") || !lastTargetUrl)) {
          lastTargetUrl = sanitizeTargetUrl(rawUrl);
        }
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) break;
        let evalTimer = null;
        const probe = await Promise.race([
          Promise.resolve().then(() =>
            candidate.evaluate((expectedFilePath) => {
              if (typeof window === "undefined") return { isDocsTarget: false, ready: false };
              const href = String(window.location?.href ?? "");
              const hasDesktopCloseBridge =
                typeof window.desktop?.onCloseCheck === "function" &&
                typeof window.desktop?.reportCloseCheck === "function";
              const isDocsUrl = href.includes("genoffice-app://docs") || href.includes("/docs/");
              if (!hasDesktopCloseBridge && !isDocsUrl) {
                return { isDocsTarget: false, ready: false, url: href };
              }
              const docObj = window.document ?? globalThis.document ?? null;
              const readyStateComplete =
                !docObj || typeof docObj.readyState !== "string" || docObj.readyState === "complete";
              const bootingEl =
                docObj && typeof docObj.querySelector === "function"
                  ? docObj.querySelector(".start-booting")
                  : null;
              const controlProbe =
                typeof window.__genofficeControl === "function"
                  ? window.__genofficeControl({ cmd: "selection" })
                  : null;
              const controlReady =
                controlProbe?.status === "ok" && Boolean(window.__aidocs?.editor);
              const ready = Boolean(
                readyStateComplete && hasDesktopCloseBridge && !bootingEl && controlReady,
              );
              if (ready) {
                try {
                  window.desktop.reportCloseCheck({
                    dirty: false,
                    autoSave: false,
                    filePath: expectedFilePath || null,
                  });
                } catch {
                  // ignore
                }
              }
              return {
                isDocsTarget: true,
                ready,
                url: href,
              };
            }, filePath),
          ),
          new Promise((resolve) => {
            evalTimer = setTimeout(() => resolve(null), Math.min(remainingMs, 1_500));
          }),
        ])
          .catch(() => null)
          .finally(() => {
            if (evalTimer !== null) clearTimeout(evalTimer);
          });

        if (probe?.url && (probe.isDocsTarget || !lastTargetUrl)) {
          lastTargetUrl = sanitizeTargetUrl(probe.url);
        }
        if (probe?.ready) {
          return {
            ready: true,
            targetUrl: sanitizeTargetUrl(probe.url || rawUrl || ""),
            elapsedMs: Date.now() - startedAt,
          };
        }
      }
    }
    const leftMs = deadline - Date.now();
    if (leftMs <= 0) break;
    await sleep(Math.min(pollIntervalMs, leftMs));
  }

  const elapsedMs = Math.max(boundMs, Date.now() - startedAt);
  const reason = formatDocsTabReadyTimeoutReason(boundMs);
  const { bindingState, binding } = readBindingSnapshotAtTimeout({
    userDataDir: userDataDir ?? portsEnv?.UNIWORK_USER_DATA ?? null,
    deploymentId,
    documentId,
    expectedUserId,
  });
  const appLogTail = readRedactedAppLogTail(runDir, APP_LOG_TAIL_LINES);
  const err = new Error(reason);
  err.isAppStepTimeout = true;
  err.owner = "g5-client";
  err.ownerCandidate = "g5-client";
  err.appStepTimeout = {
    call: "docsTabReadyToClose",
    timeoutMs: boundMs,
    elapsedMs,
    reason,
    targetUrl: lastTargetUrl,
    bindingState,
    binding,
    appLogTail,
    owner: "g5-client",
    ownerCandidate: "g5-client",
  };
  throw err;
}

function loadPlaywrightChromium(repoRoot = DEFAULT_REPO_ROOT) {
  try {
    const req = createRequire(join(repoRoot, "e2e", "package.json"));
    return req("@playwright/test").chromium;
  } catch {
    try {
      const req = createRequire(import.meta.url);
      return req("playwright").chromium;
    } catch {
      return null;
    }
  }
}

function deliverDeepLink(portsEnv, deepLink) {
  const childEnv = handoffEnv(portsEnv);
  return spawnSync(
    portsEnv.ELECTRON_BIN,
    ["--no-sandbox", "--disable-gpu", "--password-store=gnome-libsecret", portsEnv.SHELL_APP_DIR, deepLink],
    { env: childEnv, timeout: 20_000, encoding: "utf8" },
  );
}

/**
 * Drives the real D web UI (`WEB_ORIGIN`) via Playwright for Loop 1 (C2):
 * signs in at `/login`, opens `/${orgSlug}/${wsSlug}/documents/${documentId}`,
 * waits for the OfficeModuleFrame sheets wrapper (`WEB_SHEETS_READY_SELECTOR`:
 * `[data-office-docs-frame][data-office-module="sheets"][data-state="ready"]`,
 * matching `packages/views/office/frame/office-module-frame.tsx:310-334` and
 * `e2e/office-modules-web.spec.ts`), enters the X/Y/Z columns in `E1:G4`, and
 * presses `Control+s` to trigger the web frame's own Save
 * (`POST /api/v1/office-frame/documents/{id}/uploads` +
 * `POST /api/v1/office-frame/documents/{id}/versions/commit`).
 */
export async function driveWebXlsxSave({
  webOrigin,
  apiOrigin,
  email,
  password,
  orgSlug,
  wsSlug,
  documentId,
  token,
  repoRoot = DEFAULT_REPO_ROOT,
  fetchImpl = fetch,
}) {
  if (!webOrigin || fetchImpl !== fetch) {
    return { driven: false, saved: false, source: "protocol", reason: "no live webOrigin for Playwright" };
  }
  try {
    const probe = await fetchImpl(`${webOrigin}/login`, { signal: AbortSignal.timeout(3_000) });
    if (!probe.ok) {
      return { driven: false, saved: false, source: "protocol", reason: `WEB_ORIGIN ${webOrigin}/login returned ${probe.status}` };
    }
  } catch (err) {
    return { driven: false, saved: false, source: "protocol", reason: `WEB_ORIGIN ${webOrigin} unreachable: ${err.message}` };
  }

  const chromium = loadPlaywrightChromium(repoRoot);
  if (!chromium) {
    return { driven: false, saved: false, source: "protocol", reason: "Playwright chromium is not loadable" };
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const parsedWeb = new URL(webOrigin);
    await context.addCookies([
      {
        name: "uniwork-locale",
        value: "en",
        domain: parsedWeb.hostname,
        path: "/",
      },
    ]);
    const page = await context.newPage();
    await page.goto(`${webOrigin}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const passInput = page.locator('input[type="password"], input[name="password"]').first();
    await emailInput.waitFor({ state: "visible", timeout: 15_000 });
    await emailInput.fill(email);
    await passInput.fill(password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });

    await page.goto(`${webOrigin}/${orgSlug}/${wsSlug}/documents/${documentId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const host = page.locator(WEB_SHEETS_HOST_SELECTOR);
    await host.waitFor({ state: "visible", timeout: 60_000 });
    await page.locator(WEB_SHEETS_READY_SELECTOR).waitFor({ state: "visible", timeout: 90_000 });

    const frame = page.frameLocator(WEB_SHEETS_IFRAME_SELECTOR);
    const canvas = frame.locator('canvas[id^="univer-sheet-main-canvas"]').first();
    await canvas.waitFor({ state: "visible", timeout: 30_000 });
    const iframeEl = await page.locator(WEB_SHEETS_IFRAME_SELECTOR).first().elementHandle();
    const contentFrame = iframeEl ? await iframeEl.contentFrame() : null;
    if (contentFrame) {
      const wbDeadline = Date.now() + 30_000;
      while (Date.now() < wbDeadline) {
        const wbReady = await contentFrame
          .evaluate(() => {
            const st = window.__sheetsWebState;
            return st && typeof st.workbook === "function" ? st.workbook() !== null : true;
          })
          .catch(() => true);
        if (wbReady) break;
        await page.waitForTimeout(200);
      }
    }
    await canvas.click({ position: { x: 300, y: 200 } });
    const nameInput = frame.locator('[data-u-comp="defined-name"] input').first();
    await nameInput.waitFor({ state: "visible", timeout: 15_000 });

    const cells = [
      ["E1", "Net Revenue (X)"],
      ["F1", "Refunds (Y)"],
      ["G1", "Margin (Z)"],
      ["E2", "270"],
      ["F2", "30"],
      ["G2", "0.25"],
      ["E3", "175"],
      ["F3", "15"],
      ["G3", "0.1875"],
      ["E4", "460"],
      ["F4", "40"],
      ["G4", "0.1905"],
    ];
    for (const [ref, val] of cells) {
      await nameInput.click();
      await nameInput.fill(ref);
      await nameInput.press("Enter");
      await page.waitForTimeout(300);
      await page.keyboard.type(val);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(200);
    }

    await page.waitForTimeout(400);
    await canvas.click({ position: { x: 120, y: 80 } });
    await page.keyboard.press("Control+s");

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const vers = await callTracerApi({
        apiOrigin,
        fetchImpl,
        name: "listDocumentVersions",
        params: { documentID: documentId },
        token,
      });
      if ((vers.data?.versions?.length ?? 0) >= 2) {
        return { driven: true, saved: true, source: "web", editorCellsTyped: true };
      }
      await sleep(300);
    }
    const timeoutMsg = "Playwright pressed Control+s in the sheets frame but server versions did not reach 2 within 30s";
    return {
      driven: true,
      saved: false,
      source: "web",
      editorCellsTyped: true,
      error: timeoutMsg,
      reason: timeoutMsg,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      driven: true,
      saved: false,
      source: "web",
      editorCellsTyped: false,
      error: errMsg,
      reason: errMsg,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Builds the sanitized desktop sign-in decision record (`F3`, ADDENDUM r5 G1/G3)
 * for `tracer-loop-N.json`. Never includes any session token, password, or secret:
 * `signInError` goes through `redactSignInError` (G710-BE-13).
 *
 * `appPid` / `appProcessAlive` are the run's own PID-file record (G1), and
 * `cdpAttempted` / `cdpConnected` / `shellWindowFound` say which of the three
 * failures the decision saw. `keyringAvailable` is tri-state: `true`/`false` only
 * when the app itself reported it through `accountStatus()`, `null` when the
 * tracer never reached the app (G3) — the r3 record read
 * `keyringAvailable: false` with `sessionBinExists: true`, which is not a
 * combination the app can report: `session.bin` is written only while a real
 * keyring is there (`apps/shell/src/main/uniwork-auth/credentials.ts`,
 * `ensureAvailable`), and an app that cannot open the keyring keeps the file and
 * reports `keyring-unavailable` — the `false` in that record came from the
 * tracer's CDP-failure path, which never asked.
 */
export function buildSanitizedAppSignInRecord(rawInput = {}) {
  const triState = (value) => (value === undefined || value === null ? null : Boolean(value));
  const decisionInput = {
    appStarted: Boolean(rawInput.appStarted),
    appPid: Number.isInteger(Number(rawInput.appPid)) && Number(rawInput.appPid) > 0 ? Number(rawInput.appPid) : null,
    appProcessAlive: triState(rawInput.appProcessAlive),
    cdpAttempted: Boolean(rawInput.cdpAttempted),
    cdpConnected: Boolean(rawInput.cdpConnected),
    shellWindowFound: triState(rawInput.shellWindowFound),
    keyringAvailable: triState(rawInput.keyringAvailable),
    accountState: String(rawInput.accountState ?? "unknown"),
    sessionBinExists: Boolean(rawInput.sessionBinExists),
    signedInUserId: String(rawInput.signedInUserId ?? ""),
    expectedUserId: String(rawInput.expectedUserId ?? ""),
    signInError: redactSignInError(rawInput.signInError ?? ""),
    blockerReason: String(rawInput.blockerReason ?? ""),
  };
  const out = decideAppSignInOutcome(decisionInput);
  return {
    accountStatusState: decisionInput.accountState,
    sessionBinExists: decisionInput.sessionBinExists,
    decisionInput,
    decisionResult: {
      exitCode: out.exitCode,
      status: out.status,
      signedIn: Boolean(out.signedIn),
      reason: String(out.reason ?? ""),
    },
  };
}

/**
 * Connects to the running Electron app over CDP (`APP_CDP_PORT` from `ports.env`),
 * signs in as the seeded user if the OS keyring is available and no `session.bin`
 * exists yet, and exposes methods to open v1 via deep link, observe change-feed
 * reloads in `binding.json`, and drive online/offline Save through the app's own
 * `window.aiOffice.uniworkSave` and the harness-local TCP proxy (`setAppApiProxyOnline`).
 */
export async function connectAppController({
  portsEnv,
  runDir,
  repoRoot = DEFAULT_REPO_ROOT,
  apiOrigin,
  fetchImpl = fetch,
  token,
  userId,
  documentId = null,
  deploymentId = HARNESS_DEPLOYMENT_ID,
  timeoutMs = 20_000,
  appStepTimeoutMs = null,
  cdpConnector = null,
  deepLinkDeliverer = deliverDeepLink,
}) {
  const cdpPort = Number(portsEnv?.APP_CDP_PORT || 0);
  const chromium = cdpPort > 0 && !cdpConnector ? loadPlaywrightChromium(repoRoot) : null;
  let activeDocumentId = documentId || null;
  const runAppCdp = (call, fn, docId = activeDocumentId) =>
    runBoundedAppStep(call, fn, {
      timeoutMs: appStepTimeoutMs,
      portsEnv,
      runDir,
      userDataDir: portsEnv?.UNIWORK_USER_DATA ?? null,
      deploymentId,
      documentId: docId,
      expectedUserId: userId,
    });
  // The app the harness started, from the run's own PID file: every decision
  // below carries it, and a recorded process that is gone makes the loop FAIL
  // rather than BLOCK (G1 — start.sh reported this app up).
  const appProcess = readAppProcessRecord(runDir);
  const appProcessFields = { appPid: appProcess.appPid, appProcessAlive: appProcess.appProcessAlive };
  /** The controller for an app that cannot be driven here; the decision says FAIL or BLOCKED. */
  const unavailable = (recordInput) => {
    const appSignIn = buildSanitizedAppSignInRecord({ ...appProcessFields, ...recordInput });
    const outcome = appSignIn.decisionResult;
    return {
      signedIn: false,
      driven: false,
      signInFailureReason: outcome.status === "FAIL" ? outcome.reason : "",
      blockerReason: outcome.status === "BLOCKED" ? outcome.reason : "",
      appSignIn,
      appProcess,
      close: async () => {},
    };
  };
  if (!portsEnv?.UNIWORK_USER_DATA || !portsEnv?.ELECTRON_BIN || !portsEnv?.SHELL_APP_DIR) {
    return unavailable({
      appStarted: false,
      cdpAttempted: false,
      cdpConnected: false,
      accountState: "not-started",
      sessionBinExists: false,
      expectedUserId: userId ?? "",
    });
  }
  const sessionBinPath = join(portsEnv.UNIWORK_USER_DATA, "uniwork-auth", "session.bin");
  if (!cdpPort || (!cdpConnector && !chromium)) {
    const pre = checkDesktopPrecondition(portsEnv);
    const reason = pre.ok
      ? "the app's Save cannot be driven headlessly (no APP_CDP_PORT in ports.env)"
      : pre.reason;
    return unavailable({
      appStarted: true,
      cdpAttempted: false,
      cdpConnected: false,
      accountState: pre.ok ? "signed-in" : "no-cdp",
      sessionBinExists: existsSync(sessionBinPath),
      expectedUserId: userId ?? "",
      blockerReason: reason,
    });
  }

  let browser;
  const closeBrowserBounded = async () => {
    if (!browser) return;
    await Promise.race([
      Promise.resolve()
        .then(() => browser.close())
        .catch(() => {}),
      sleep(1_000),
    ]);
  };
  try {
    browser = await runAppCdp("connect", () =>
      cdpConnector
        ? cdpConnector(cdpPort)
        : chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, {
            timeout: resolveAppStepTimeoutMs(appStepTimeoutMs, portsEnv),
          }),
    );
  } catch (err) {
    if (err?.isAppStepTimeout) {
      err.appSignIn = buildSanitizedAppSignInRecord({
        ...appProcessFields,
        appStarted: true,
        cdpAttempted: true,
        cdpConnected: false,
        accountState: "cdp-timeout",
        sessionBinExists: existsSync(sessionBinPath),
        expectedUserId: userId ?? "",
        blockerReason: err.message,
      });
      throw err;
    }
    const pre = checkDesktopPrecondition(portsEnv);
    const reason = pre.ok
      ? `could not connect to the running Electron app over CDP port ${cdpPort}: ${err.message}`
      : pre.reason;
    return unavailable({
      appStarted: true,
      cdpAttempted: true,
      cdpConnected: false,
      accountState: pre.ok ? "signed-in" : "cdp-unreachable",
      sessionBinExists: existsSync(sessionBinPath),
      expectedUserId: userId ?? "",
      blockerReason: reason,
    });
  }

  let page = null;
  let status = null;
  let signInError = "";
  const getProfileAccountId = (st) => st?.profile?.accountId ?? st?.profile?.id ?? "";

  try {
    const findShellPage = async () => {
      for (const ctx of browser.contexts()) {
        for (const p of ctx.pages()) {
          const hasApi = await runAppCdp("window.aiOffice", () =>
            p.evaluate(() => typeof window.aiOffice === "object"),
          ).catch((err) => {
            if (err?.isAppStepTimeout) throw err;
            return false;
          });
          if (hasApi) return p;
        }
      }
      return null;
    };

    page = await findShellPage();
    for (let i = 0; i < 20 && !page; i += 1) {
      await sleep(250);
      page = await findShellPage();
    }
    if (!page) {
      await closeBrowserBounded();
      const reason = "connected to Electron CDP but found no shell renderer window exposing window.aiOffice";
      return unavailable({
        appStarted: true,
        cdpAttempted: true,
        cdpConnected: true,
        shellWindowFound: false,
        accountState: "no-shell-window",
        sessionBinExists: existsSync(sessionBinPath),
        expectedUserId: userId ?? "",
        blockerReason: reason,
      });
    }

    status = await runAppCdp("aiOffice.accountStatus", () =>
      page.evaluate(() => window.aiOffice.accountStatus()),
    );
    const refreshDeadline = Date.now() + 5_000;
    while (status?.state === "refreshing" && Date.now() < refreshDeadline) {
      await sleep(200);
      status = await runAppCdp("aiOffice.accountStatus", () =>
        page.evaluate(() => window.aiOffice.accountStatus()),
      );
    }

    if (status?.state === "keyring-unavailable" || status?.state === "keystore-locked") {
      await closeBrowserBounded();
      // The keyring is the one desktop precondition the VM may genuinely lack: the
      // app itself said so, so the record may say `keyringAvailable: false`.
      return unavailable({
        appStarted: true,
        cdpAttempted: true,
        cdpConnected: true,
        shellWindowFound: true,
        keyringAvailable: false,
        accountState: status.state,
        sessionBinExists: existsSync(sessionBinPath),
        expectedUserId: userId ?? "",
      });
    }

    if (
      status?.state !== "signed-in" ||
      !existsSync(sessionBinPath) ||
      (userId && getProfileAccountId(status) && getProfileAccountId(status) !== userId)
    ) {
      if (status?.state === "signed-in") {
        await runAppCdp("aiOffice.accountLogout", () =>
          page.evaluate(() => window.aiOffice.accountLogout()),
        ).catch((err) => {
          if (err?.isAppStepTimeout) throw err;
        });
      } else if (status?.state === "signing-in") {
        await runAppCdp("aiOffice.accountCancelLogin", () =>
          page.evaluate(() => window.aiOffice.accountCancelLogin?.()),
        ).catch((err) => {
          if (err?.isAppStepTimeout) throw err;
        });
      }
      try {
        const authUrl = await runAppCdp("aiOffice.accountLogin", () =>
          page.evaluate(
            () =>
              new Promise((resolveUrl, rejectUrl) => {
                const timer = setTimeout(() => rejectUrl(new Error("accountLogin url timeout")), 15_000);
                const off = window.aiOffice.onAccountLogin((ev) => {
                  if (ev && ev.phase === "url" && ev.url) {
                    clearTimeout(timer);
                    off();
                    resolveUrl(ev.url);
                  } else if (ev && ev.phase === "error") {
                    clearTimeout(timer);
                    off();
                    rejectUrl(new Error(`accountLogin error: ${ev.error}`));
                  }
                });
                window.aiOffice.accountLogin().catch((err) => {
                  clearTimeout(timer);
                  off();
                  rejectUrl(err);
                });
              }),
          ),
        );
        const attemptId = new URL(authUrl).searchParams.get("attempt_id");
        if (!attemptId) {
          throw new Error(`accountLogin URL carried no attempt_id: ${authUrl}`);
        }
        const consentGet = await callTracerApi({
          apiOrigin,
          fetchImpl,
          name: "getDesktopConsent",
          query: { attempt_id: attemptId },
          token,
        });
        const csrfToken = consentGet.data?.csrf_token ?? "";
        if (!csrfToken) {
          throw new Error("getDesktopConsent returned no csrf_token");
        }
        const consentPost = await callTracerApi({
          apiOrigin,
          fetchImpl,
          name: "submitDesktopConsent",
          token,
          body: { attempt_id: attemptId, csrf_token: csrfToken, decision: "approve" },
        });
        const callbackUrl = consentPost.data?.callback_url ?? consentPost.data?.redirect_url ?? "";
        if (!callbackUrl) throw new Error("submitDesktopConsent returned no callback_url");
        const handoff = deepLinkDeliverer(portsEnv, callbackUrl);
        if (handoff?.error || (typeof handoff?.status === "number" && handoff.status !== 0)) {
          throw new Error(
            `callback deep-link handoff failed (exit ${handoff?.status ?? "err"}): ${handoff?.stderr || handoff?.error?.message || ""}`.trim(),
          );
        }
        const signDeadline = Date.now() + 15_000;
        while (Date.now() < signDeadline) {
          status = await runAppCdp("aiOffice.accountStatus", () =>
            page.evaluate(() => window.aiOffice.accountStatus()),
          );
          if (status?.state === "signed-in" && existsSync(sessionBinPath)) break;
          if (status?.state === "keyring-unavailable" || status?.state === "keystore-locked") break;
          await sleep(250);
        }
      } catch (err) {
        if (err?.isAppStepTimeout) throw err;
        signInError = err instanceof Error ? err.message : String(err);
        status = await runAppCdp("aiOffice.accountStatus", () =>
          page.evaluate(() => window.aiOffice.accountStatus()),
        ).catch((statusErr) => {
          if (statusErr?.isAppStepTimeout) throw statusErr;
          return status;
        });
      }
    }
  } catch (err) {
    await closeBrowserBounded();
    if (err?.isAppStepTimeout) {
      err.appSignIn = buildSanitizedAppSignInRecord({
        ...appProcessFields,
        appStarted: true,
        cdpAttempted: true,
        cdpConnected: true,
        shellWindowFound: Boolean(page),
        keyringAvailable: page ? true : null,
        accountState: status?.state ?? "cdp-step-timeout",
        sessionBinExists: existsSync(sessionBinPath),
        signedInUserId: getProfileAccountId(status),
        expectedUserId: userId ?? "",
        signInError: err.message,
      });
    }
    throw err;
  }

  const keyringStillAvailable =
    status?.state !== "keyring-unavailable" && status?.state !== "keystore-locked";
  const appSignIn = buildSanitizedAppSignInRecord({
    ...appProcessFields,
    appStarted: true,
    cdpAttempted: true,
    cdpConnected: true,
    shellWindowFound: true,
    keyringAvailable: keyringStillAvailable,
    accountState: status?.state ?? "unknown",
    sessionBinExists: existsSync(sessionBinPath),
    signedInUserId: getProfileAccountId(status),
    expectedUserId: userId ?? "",
    signInError,
  });
  const signInOutcome = appSignIn.decisionResult;

  if (!signInOutcome.signedIn) {
    await closeBrowserBounded();
    return {
      signedIn: false,
      driven: false,
      signInFailureReason: signInOutcome.status === "FAIL" ? signInOutcome.reason : "",
      blockerReason: signInOutcome.status === "BLOCKED" ? signInOutcome.reason : "",
      appSignIn,
      close: async () => {},
    };
  }

  // Why closeOpenTabForPath cannot be dropped (item c):
  //   In `apps/shell/src/main/uniwork-docs/service.ts:2533-2553`,
  //   `UniworkDocsService.save(path)` (`window.aiOffice.uniworkSave(path)`) checks
  //   `if (intent !== true && this.deps.requestModuleSave(doc.path)) return this.statusOf(doc)`.
  //   In `apps/shell/src/main/uniwork-docs/module-save.ts:30-70` (`createModuleSaveRequester`),
  //   if a docs tab is still open for `doc.path`, `requestModuleSave` returns `true` and
  //   sends `wc.send('menu:command', 'save')` (`module-save.ts:48-50`) to the open docs
  //   renderer instead of calling `this.coordinator.save(doc.path)` (`service.ts:2551`).
  //   In `apps/docs/src/main/docs-main.ts:4751-4800`, `docs:save` checks
  //   `if (await diskChangedExternally(event.sender.id, filePath))` (`docs-main.ts:4763`),
  //   which opens a native modal `dialog.showMessageBox` (`extModifiedMsg`: Overwrite / Cancel)
  //   because `v2Bytes` was written on disk, and would overwrite `v2Bytes` with the editor's
  //   in-memory v1 state. Only when the tab is closed (`requestModuleSave` returns `false`)
  //   does `UniworkDocsService.save` run `this.coordinator.save(doc.path)`
  //   (`save-coordinator.ts:264-360`) on the `v2Bytes` working copy.
  const closeOpenTabForPath = async (filePath, docId = activeDocumentId) => {
    const matchingTabs = await runAppCdp(
      "aiOfficeTabs.list",
      () =>
        page.evaluate(async (targetPath) => {
          if (!window.aiOfficeTabs?.list || !window.aiOfficeTabs?.close) return [];
          const list = await window.aiOfficeTabs.list();
          const tabs = Array.isArray(list?.tabs) ? list.tabs : Array.isArray(list) ? list : [];
          return tabs
            .filter((t) => t && t.filePath === targetPath && t.id)
            .map((t) => ({
              id: t.id,
              kind: t.kind ?? null,
              filePath: t.filePath,
            }));
        }, filePath),
      docId,
    ).catch((err) => {
      if (err?.isAppStepTimeout) throw err;
      return [];
    });
    if (!Array.isArray(matchingTabs) || matchingTabs.length === 0) return;

    for (const tab of matchingTabs) {
      const isDocsTab =
        tab.kind === "docs" ||
        (!tab.kind && typeof tab.filePath === "string" && /\.docx$/i.test(tab.filePath));
      if (isDocsTab) {
        await waitForDocsTabReadyToClose({
          browser,
          shellPage: page,
          filePath: tab.filePath,
          timeoutMs: appStepTimeoutMs,
          portsEnv,
          runDir,
          userDataDir: portsEnv?.UNIWORK_USER_DATA ?? null,
          deploymentId,
          documentId: docId,
          expectedUserId: userId,
        });
      }
      await runAppCdp(
        "aiOfficeTabs.close",
        () =>
          page.evaluate(async (tabId) => {
            if (!window.aiOfficeTabs?.close) return;
            await window.aiOfficeTabs.close(tabId);
          }, tab.id),
        docId,
      ).catch((err) => {
        if (err?.isAppStepTimeout) throw err;
      });
    }
  };

  return {
    signedIn: true,
    driven: true,
    signInFailureReason: "",
    blockerReason: "",
    appSignIn,
    close: async () => {
      await closeBrowserBounded();
    },
    openDocumentV1: async ({ documentId: docId }) => {
      activeDocumentId = docId;
      const launchRes = await callTracerApi({
        apiOrigin,
        fetchImpl,
        name: "mintLaunch",
        params: { documentID: docId },
        token,
        body: {
          operation: "edit",
          deployment_id: deploymentId,
          client_id: DEV_CLIENT_ID,
          return_hint: "",
        },
      });
      const ticket = launchRes.data?.ticket ?? launchRes.data?.launch_ticket ?? "";
      if (!ticket) return { opened: false, binding: null };
      const deepLink = officeDeepLink(DEV_CLIENT_ID, ticket);
      const handoff = deepLinkDeliverer(portsEnv, deepLink);
      if (handoff.error || handoff.status !== 0) return { opened: false, binding: null };
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const wc = inspectWorkingCopy({
          userDataDir: portsEnv.UNIWORK_USER_DATA,
          deploymentId,
          documentId: docId,
          expectedUserId: userId,
        });
        if (wc.bindingPresent && wc.filePresent && Number(wc.binding?.baseVersion ?? 0) === 1) {
          return { opened: true, binding: wc.binding, workingCopyFilePath: wc.workingCopyFilePath };
        }
        await sleep(250);
      }
      return { opened: false, binding: null };
    },
    waitForFeedReloadV2: async ({ documentId: docId, expectedSha256 }) => {
      activeDocumentId = docId;
      // Do NOT close the open tab for `documentId` before feed reload (F1b):
      // `UniworkDocsService.noteRemoteChange` (`apps/shell/src/main/uniwork-docs/service.ts:3117`)
      // checks `if (!doc || !this.deps.isPathOpen(doc.path)) return`, so the tab opened in
      // `openDocumentV1` must remain open for `guardedReload` (`service.ts:3455-3544`) to run.
      const checkReloaded = () => {
        const wc = inspectWorkingCopy({
          userDataDir: portsEnv.UNIWORK_USER_DATA,
          deploymentId,
          documentId: docId,
          expectedUserId: userId,
          expectedSha256,
        });
        if (
          wc.bindingPresent &&
          wc.filePresent &&
          wc.sha256Match &&
          wc.bindingState === "saved" &&
          Number(wc.binding?.baseVersion ?? 0) === 2
        ) {
          return { reloaded: true, binding: wc.binding };
        }
        return null;
      };
      const immediate = checkReloaded();
      if (immediate) return immediate;

      // Trigger an immediate SyncRuntime pass by toggling the app proxy and calling accountRetry()
      setAppApiProxyOnline(runDir, false);
      await runAppCdp(
        "aiOffice.accountRetry",
        () => page.evaluate(() => window.aiOffice.accountRetry()),
        docId,
      ).catch((err) => {
        if (err?.isAppStepTimeout) throw err;
      });
      setAppApiProxyOnline(runDir, true);
      await runAppCdp(
        "aiOffice.accountRetry",
        () => page.evaluate(() => window.aiOffice.accountRetry()),
        docId,
      ).catch((err) => {
        if (err?.isAppStepTimeout) throw err;
      });

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const hit = checkReloaded();
        if (hit) return hit;
        await sleep(300);
      }
      const last = inspectWorkingCopy({
        userDataDir: portsEnv.UNIWORK_USER_DATA,
        deploymentId,
        documentId: docId,
        expectedUserId: userId,
        expectedSha256,
      });
      return { reloaded: false, binding: last.binding };
    },
    saveOnlineInApp: async ({ documentId: docId, v2Bytes, expectedSha256 }) => {
      activeDocumentId = docId;
      const wc0 = inspectWorkingCopy({
        userDataDir: portsEnv.UNIWORK_USER_DATA,
        deploymentId,
        documentId: docId,
        expectedUserId: userId,
      });
      if (!wc0.workingCopyFilePath) return { saved: false, binding: null };
      await closeOpenTabForPath(wc0.workingCopyFilePath, docId);
      writeFileSync(wc0.workingCopyFilePath, v2Bytes);
      await runAppCdp(
        "aiOffice.uniworkSave",
        () => page.evaluate((p) => window.aiOffice.uniworkSave(p), wc0.workingCopyFilePath),
        docId,
      );
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const wc = inspectWorkingCopy({
          userDataDir: portsEnv.UNIWORK_USER_DATA,
          deploymentId,
          documentId: docId,
          expectedUserId: userId,
          expectedSha256,
        });
        if (wc.bindingPresent && wc.bindingState === "saved" && Number(wc.binding?.baseVersion ?? 0) === 2) {
          return { saved: true, binding: wc.binding };
        }
        if (wc.bindingState === "conflict" || wc.bindingState === "error") {
          return { saved: false, binding: wc.binding };
        }
        await sleep(250);
      }
      return { saved: false, binding: null };
    },
    saveOfflineWhileCut: async ({ documentId: docId, v2Bytes, v2Sha256 }) => {
      activeDocumentId = docId;
      const wc0 = inspectWorkingCopy({
        userDataDir: portsEnv.UNIWORK_USER_DATA,
        deploymentId,
        documentId: docId,
        expectedUserId: userId,
      });
      if (!wc0.workingCopyFilePath) {
        return { bindingWhileCut: null, intentFilesWhileCut: [], v2Sha256 };
      }
      await closeOpenTabForPath(wc0.workingCopyFilePath, docId);
      writeFileSync(wc0.workingCopyFilePath, v2Bytes);
      setAppApiProxyOnline(runDir, false);
      await runAppCdp(
        "aiOffice.uniworkSave",
        () => page.evaluate((p) => window.aiOffice.uniworkSave(p), wc0.workingCopyFilePath),
        docId,
      ).catch((err) => {
        if (err?.isAppStepTimeout) throw err;
      });
      await sleep(300);
      const wcCut = inspectWorkingCopy({
        userDataDir: portsEnv.UNIWORK_USER_DATA,
        deploymentId,
        documentId: docId,
        expectedUserId: userId,
      });
      const intentFilesWhileCut = listAppSyncIntentFiles(portsEnv.UNIWORK_USER_DATA, deploymentId, userId);
      return {
        bindingWhileCut: wcCut.binding,
        intentFilesWhileCut,
        v2Sha256,
        workingCopyFilePath: wc0.workingCopyFilePath,
      };
    },
    reconnectAndFlushSave: async ({ documentId: docId, expectedSha256 }) => {
      activeDocumentId = docId;
      const wc0 = inspectWorkingCopy({
        userDataDir: portsEnv.UNIWORK_USER_DATA,
        deploymentId,
        documentId: docId,
        expectedUserId: userId,
      });
      setAppApiProxyOnline(runDir, true);
      await runAppCdp(
        "aiOffice.accountRetry",
        () => page.evaluate(() => window.aiOffice.accountRetry()),
        docId,
      ).catch((err) => {
        if (err?.isAppStepTimeout) throw err;
      });
      if (wc0.workingCopyFilePath) {
        await runAppCdp(
          "aiOffice.uniworkSave",
          () => page.evaluate((p) => window.aiOffice.uniworkSave(p), wc0.workingCopyFilePath),
          docId,
        ).catch((err) => {
          if (err?.isAppStepTimeout) throw err;
        });
      }
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const wc = inspectWorkingCopy({
          userDataDir: portsEnv.UNIWORK_USER_DATA,
          deploymentId,
          documentId: docId,
          expectedUserId: userId,
          expectedSha256,
        });
        if (
          wc.bindingPresent &&
          (wc.bindingState === "saved" || wc.bindingState === "conflict" || wc.bindingState === "error") &&
          (wc.bindingState !== "saved" || Number(wc.binding?.baseVersion ?? 0) >= 2)
        ) {
          return {
            bindingAfterReconnect: wc.binding,
            intentFilesAfterReconnect: listAppSyncIntentFiles(portsEnv.UNIWORK_USER_DATA, deploymentId, userId),
          };
        }
        await sleep(250);
      }
      const last = inspectWorkingCopy({
        userDataDir: portsEnv.UNIWORK_USER_DATA,
        deploymentId,
        documentId: docId,
        expectedUserId: userId,
        expectedSha256,
      });
      return {
        bindingAfterReconnect: last.binding,
        intentFilesAfterReconnect: listAppSyncIntentFiles(portsEnv.UNIWORK_USER_DATA, deploymentId, userId),
      };
    },
  };
}

function resolveAppSignInForCtrl(appCtrl, expectedUserId = "") {
  if (appCtrl?.appSignIn) return appCtrl.appSignIn;
  // A stub app driver (the unit tests, and nothing in the live path) never talked
  // to an app, so it is not asked about a keyring: what it claims is what it is.
  const signedIn = Boolean(appCtrl?.signedIn);
  const failReason = String(appCtrl?.signInFailureReason ?? "");
  const blockReason = String(appCtrl?.blockerReason ?? "");
  return buildSanitizedAppSignInRecord({
    ...(appCtrl?.appProcess ?? {}),
    appStarted: signedIn || Boolean(failReason),
    cdpAttempted: signedIn || Boolean(failReason),
    cdpConnected: signedIn || Boolean(failReason),
    shellWindowFound: signedIn || Boolean(failReason),
    keyringAvailable: signedIn || Boolean(failReason) ? true : null,
    accountState: signedIn ? "signed-in" : failReason ? "signed-out" : "not-started",
    sessionBinExists: signedIn,
    signedInUserId: signedIn ? String(expectedUserId ?? "") : "",
    expectedUserId: String(expectedUserId ?? ""),
    signInError: failReason,
    blockerReason: blockReason,
  });
}

function finalizeLoopOutcome(decision, loopState) {
  const owner = decision.owner || UPSTREAM_BLOCKED_OWNER;
  const appSignIn =
    loopState.details?.appSignIn ??
    buildSanitizedAppSignInRecord({
      appStarted: false,
      cdpAttempted: false,
      cdpConnected: false,
      keyringAvailable: null,
      accountState: "not-started",
      sessionBinExists: false,
    });
  const timeoutInfo = loopState.details?.appStepTimeout ?? null;
  const details = {
    ...loopState.details,
    owner,
    appSignIn,
    ...loopState.versionCounts,
    steps: loopState.steps,
    versionCounts: loopState.versionCounts,
  };
  return {
    exitCode: decision.exitCode,
    status: decision.status,
    owner,
    reason: decision.reason,
    appSignIn,
    ...(timeoutInfo
      ? {
          call: timeoutInfo.call,
          elapsedMs: timeoutInfo.elapsedMs,
          bindingState: timeoutInfo.bindingState,
          binding: timeoutInfo.binding,
          appLogTail: timeoutInfo.appLogTail,
          ...(timeoutInfo.targetUrl !== undefined ? { targetUrl: timeoutInfo.targetUrl } : {}),
          ...(timeoutInfo.ownerCandidate ? { ownerCandidate: timeoutInfo.ownerCandidate } : {}),
          appStepTimeout: timeoutInfo,
        }
      : {}),
    steps: loopState.steps,
    versionCounts: loopState.versionCounts,
    details,
  };
}

function recordLoopException(err, loopState, currentStep) {
  const errMsg = err instanceof Error ? err.message : String(err);
  if (err?.appSignIn && !loopState.details.appSignIn) {
    loopState.details.appSignIn = err.appSignIn;
  }
  const timeoutInfo = err?.appStepTimeout ?? null;
  const owner = err?.owner || timeoutInfo?.owner || UPSTREAM_BLOCKED_OWNER;
  if (timeoutInfo) {
    loopState.details.appStepTimeout = timeoutInfo;
    loopState.details.call = timeoutInfo.call;
    loopState.details.elapsedMs = timeoutInfo.elapsedMs;
    loopState.details.bindingState = timeoutInfo.bindingState;
    loopState.details.binding = timeoutInfo.binding;
    loopState.details.appLogTail = timeoutInfo.appLogTail;
    if (timeoutInfo.targetUrl !== undefined) {
      loopState.details.targetUrl = timeoutInfo.targetUrl;
    }
    if (timeoutInfo.ownerCandidate) {
      loopState.details.ownerCandidate = timeoutInfo.ownerCandidate;
    }
  }
  if (loopState.steps[currentStep]) {
    loopState.steps[currentStep] = {
      ...loopState.steps[currentStep],
      status: "FAIL",
      reason: errMsg,
      ...(timeoutInfo
        ? {
            call: timeoutInfo.call,
            elapsedMs: timeoutInfo.elapsedMs,
            bindingState: timeoutInfo.bindingState,
            binding: timeoutInfo.binding,
            appLogTail: timeoutInfo.appLogTail,
            ...(timeoutInfo.targetUrl !== undefined ? { targetUrl: timeoutInfo.targetUrl } : {}),
            ...(timeoutInfo.ownerCandidate ? { ownerCandidate: timeoutInfo.ownerCandidate } : {}),
          }
        : {}),
    };
  }
  return finalizeLoopOutcome(
    {
      exitCode: 1,
      status: "FAIL",
      owner,
      reason: errMsg,
    },
    loopState,
  );
}

// ---- Loop 1: fx-xlsx-revenue-xyz (Web -> AI -> Editor X/Y/Z Save -> Feed -> App) ----

async function runLoop1({
  apiOrigin,
  portsEnv,
  runDir,
  repoRoot,
  fetchImpl = fetch,
  timeoutMs = 20_000,
  webDriver = null,
  appDriver = null,
  cdpConnector = null,
  deepLinkDeliverer = deliverDeepLink,
  watchdogHook = null,
}) {
  const loopState = {
    steps: {
      appOpenV1: { source: "app", status: "PENDING" },
      webFrameOpen: { source: "protocol", status: "PENDING" },
      aiTurn: { source: "protocol", status: "PENDING" },
      webSave: { source: "protocol", status: "PENDING" },
      changeFeed: { source: "protocol", status: "PENDING" },
      appReloadV2: { source: "protocol", status: "PENDING" },
    },
    versionCounts: {
      versionsBeforeTurn: null,
      versionsAfterTurn: null,
      versionsAfterSave: null,
    },
    details: {
      loop: "1",
      fixtureId: "fx-xlsx-revenue-xyz",
    },
  };
  let currentStep = "webFrameOpen";
  let appCtrl = null;
  if (watchdogHook) {
    watchdogHook.loopState = loopState;
    watchdogHook.getCurrentStep = () => currentStep;
    watchdogHook.getAppCtrl = () => appCtrl;
  }

  try {
    const seeded = await seedFixtureDocument({
      apiOrigin,
      runDir,
      fetchImpl,
      fixtureId: "fx-xlsx-revenue-xyz",
      repoRoot,
    });
    const {
      email,
      password,
      token,
      userId,
      organizationSlug,
      workspaceId,
      workspaceSlug,
      documentId,
      filename,
      fixture,
    } = seeded;
    loopState.details.documentId = documentId;
    loopState.details.workspaceId = workspaceId;
    loopState.details.v1Sha256 = fixture.sha256;

    const deploymentId = portsEnv.HARNESS_DEPLOYMENT_ID || HARNESS_DEPLOYMENT_ID;
    currentStep = "appOpenV1";
    appCtrl =
      appDriver ??
      (await connectAppController({
        portsEnv,
        runDir,
        repoRoot,
        apiOrigin,
        fetchImpl,
        token: seeded.token,
        userId: seeded.userId,
        documentId: seeded.documentId,
        deploymentId,
        timeoutMs,
        cdpConnector,
        deepLinkDeliverer,
      }));
    loopState.details.appSignIn = resolveAppSignInForCtrl(appCtrl, seeded.userId);
    loopState.details.appDesktopPrecondition = appCtrl.signedIn
      ? "signed_in"
      : appCtrl.signInFailureReason || appCtrl.blockerReason;

    // 1. If the desktop app is signed in and reachable via CDP, open v1 in the app first
    //    so its working copy / binding.json settles at baseVersion: 1 before the web saves v2.
    let appOpenedV1 = false;
    let appV1Binding = null;
    if (appCtrl.signedIn && appCtrl.driven && typeof appCtrl.openDocumentV1 === "function") {
      const opened = await appCtrl.openDocumentV1({ documentId, userId });
      appOpenedV1 = Boolean(opened?.opened && Number(opened?.binding?.baseVersion ?? 0) === 1);
      appV1Binding = opened?.binding ?? null;
      loopState.steps.appOpenV1 = {
        source: "app",
        status: appOpenedV1 ? "PASS" : "FAIL",
      };
    } else {
      loopState.steps.appOpenV1 = {
        source: "app",
        status: appCtrl.signInFailureReason ? "FAIL" : "BLOCKED",
        reason: appCtrl.signInFailureReason || appCtrl.blockerReason || "app not signed in",
      };
    }
    loopState.details.appOpenedV1 = appOpenedV1;
    loopState.details.appV1Binding = appV1Binding;

    // 2. Capture initial workspace change-feed snapshot cursor at v1 (drain snapshot pages if has_more).
    currentStep = "webFrameOpen";
    let initialFeed = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "listDocumentChanges",
      params: { workspaceID: workspaceId },
      token,
    });
    let initialCursor = initialFeed.data?.next_cursor ?? "";
    for (let pageIdx = 0; pageIdx < 10 && initialFeed.data?.has_more && initialCursor; pageIdx += 1) {
      initialFeed = await callTracerApi({
        apiOrigin,
        fetchImpl,
        name: "listDocumentChanges",
        params: { workspaceID: workspaceId },
        query: { cursor: initialCursor },
        token,
      });
      initialCursor = initialFeed.data?.next_cursor ?? initialCursor;
    }

    // 3. Open on Web via the office-frame token + frame document/content API.
    const frameTokenRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "mintOfficeFrameToken",
      params: { documentID: documentId },
      token,
    });
    const frameToken = frameTokenRes.data?.token;
    if (!frameToken) {
      loopState.steps.webFrameOpen = { source: "protocol", status: "FAIL", reason: "empty frame token" };
      return finalizeLoopOutcome(
        {
          exitCode: 1,
          status: "FAIL",
          owner: UPSTREAM_BLOCKED_OWNER,
          reason: "mintOfficeFrameToken returned an empty token",
        },
        loopState,
      );
    }

    const frameDoc = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "openOfficeFrameDocument",
      params: { documentID: documentId },
      token: frameToken,
    });
    const v1Revision = frameDoc.data?.revision;
    const v1Version = frameDoc.data?.file?.version;
    const v1Checksum = frameDoc.data?.file?.checksum_sha256;
    if (v1Version !== 1 || v1Checksum !== fixture.sha256 || !v1Revision) {
      loopState.steps.webFrameOpen = { source: "protocol", status: "FAIL" };
      loopState.details.v1Version = v1Version;
      loopState.details.v1Checksum = v1Checksum;
      loopState.details.expectedSha256 = fixture.sha256;
      return finalizeLoopOutcome(
        {
          exitCode: 1,
          status: "FAIL",
          owner: UPSTREAM_BLOCKED_OWNER,
          reason: `openOfficeFrameDocument v1 mismatch: version=${v1Version}, checksum=${v1Checksum}, expected=${fixture.sha256}`,
        },
        loopState,
      );
    }

    const contentRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "getOfficeFrameDocumentContent",
      params: { documentID: documentId },
      token: frameToken,
      expectBinary: true,
    });
    if (sha256Hex(contentRes.bytes) !== fixture.sha256) {
      loopState.steps.webFrameOpen = { source: "protocol", status: "FAIL" };
      return finalizeLoopOutcome(
        {
          exitCode: 1,
          status: "FAIL",
          owner: UPSTREAM_BLOCKED_OWNER,
          reason: "getOfficeFrameDocumentContent bytes did not match fx-xlsx-revenue-xyz v1 sha256",
        },
        loopState,
      );
    }
    loopState.steps.webFrameOpen = { source: "protocol", status: "PASS" };

    // 4. Count server versions before the AI turn, run the AI turn, and verify
    //    G6-A03 invariant: the AI turn itself creates 0 versions and 0 uploads.
    currentStep = "aiTurn";
    const versionsBeforeRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "listDocumentVersions",
      params: { documentID: documentId },
      token,
    });
    const versionsBeforeTurn = versionsBeforeRes.data?.versions?.length ?? 0;
    loopState.versionCounts.versionsBeforeTurn = versionsBeforeTurn;

    const aiTurnRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "aiUniworkFrameChatCompletions",
      params: { documentID: documentId },
      token: frameToken,
      body: {
        messages: [
          {
            role: "user",
            content:
              "Tính cột X (Tổng Q1+Q2), Y (Chênh lệch Q2-Q1), Z (Tỷ lệ tăng trưởng Y/Q1) cho bảng Doanh thu.",
          },
        ],
      },
      allowStatuses: [403, 503],
    });

    const versionsAfterTurnRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "listDocumentVersions",
      params: { documentID: documentId },
      token,
    });
    const versionsAfterTurn = versionsAfterTurnRes.data?.versions?.length ?? 0;
    loopState.versionCounts.versionsAfterTurn = versionsAfterTurn;

    const docAfterTurnRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "getDocument",
      params: { documentID: documentId },
      token,
    });
    const revisionAfterTurn = docAfterTurnRes.data?.document?.revision;

    if (versionsAfterTurn !== versionsBeforeTurn || revisionAfterTurn !== v1Revision) {
      loopState.steps.aiTurn = { source: "protocol", status: "FAIL" };
      loopState.details.v1Revision = v1Revision;
      loopState.details.revisionAfterTurn = revisionAfterTurn;
      return finalizeLoopOutcome(
        {
          exitCode: 1,
          status: "FAIL",
          owner: UPSTREAM_BLOCKED_OWNER,
          reason: `G6-A03 violation: AI turn created a server version or changed revision before user Save (versions ${versionsBeforeTurn} -> ${versionsAfterTurn}, revision ${v1Revision} -> ${revisionAfterTurn})`,
        },
        loopState,
      );
    }

    const v2Workbook = buildXlsxRevenueWithXyzBytes(repoRoot);
    const aiSegment = classifyAiResponse(aiTurnRes, v2Workbook.expectedXyz, {
      allowRealUpstream: Boolean(
        fetchImpl?.allowRealAiUpstream || process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM === "1",
      ),
    });
    loopState.details.aiSegment = aiSegment;
    loopState.steps.aiTurn = {
      source: "protocol",
      status: aiSegment.status,
      httpStatus: aiTurnRes.status,
      reason: aiSegment.reason ?? "",
    };

    // 5. Drive the Web Save: first try the real Playwright web UI against WEB_ORIGIN
    //    (or injected webDriver). If WEB_ORIGIN is not live (e.g. protocol-only unit test),
    //    run the protocol diagnostic commit (`source: "protocol"`) so server invariants
    //    are still checked, while `webSaveSource: "protocol"` prevents a false PASS.
    currentStep = "webSave";
    const webUiRes =
      typeof webDriver === "function"
        ? await webDriver({
            webOrigin: portsEnv.WEB_ORIGIN,
            apiOrigin,
            email,
            password,
            orgSlug: organizationSlug,
            wsSlug: workspaceSlug,
            documentId,
            token: frameToken,
            userToken: token,
          })
        : await driveWebXlsxSave({
            webOrigin: portsEnv.WEB_ORIGIN,
            apiOrigin,
            email,
            password,
            orgSlug: organizationSlug,
            wsSlug: workspaceSlug,
            documentId,
            token,
            repoRoot,
            fetchImpl,
          });

    const webUiDriven = Boolean(webUiRes?.driven && webUiRes?.saved);
    const webUiAttempted = Boolean(webUiRes?.driven);
    const webUiError = webUiAttempted && !webUiDriven ? webUiRes?.error || webUiRes?.reason || "web UI did not save v2" : "";
    const webSaveSource = webUiAttempted ? "web" : "protocol";
    let v2Checksum = v2Workbook.sha256;

    if (webUiAttempted) {
      loopState.steps.webSave = {
        source: "web",
        status: webUiDriven ? "PASS" : "FAIL",
        ...(webUiError ? { reason: webUiError } : {}),
      };
    }

    if (!webUiDriven) {
      const uploadForm = new FormData();
      uploadForm.append("file", new Blob([v2Workbook.bytes]), filename);
      const uploadRes = await callTracerApi({
        apiOrigin,
        fetchImpl,
        name: "uploadOfficeFrameFile",
        params: { documentID: documentId },
        token: frameToken,
        form: uploadForm,
      });
      const uploadId = uploadRes.data?.upload_id;
      if (!uploadId || uploadRes.data?.checksum_sha256 !== v2Workbook.sha256) {
        if (!webUiAttempted) loopState.steps.webSave = { source: "protocol", status: "FAIL" };
        loopState.details.upload = uploadRes.data;
        loopState.details.expectedSha256 = v2Workbook.sha256;
        return finalizeLoopOutcome(
          {
            exitCode: 1,
            status: "FAIL",
            owner: UPSTREAM_BLOCKED_OWNER,
            reason: "uploadOfficeFrameFile did not return a matching upload_id and sha256",
          },
          loopState,
        );
      }
      const commitKey = `g710-loop1-${documentId}-v2`;
      const commitRes = await callTracerApi({
        apiOrigin,
        fetchImpl,
        name: "commitOfficeFrameVersion",
        params: { documentID: documentId },
        token: frameToken,
        headers: { "Idempotency-Key": commitKey },
        body: { upload_id: uploadId, base_revision: v1Revision },
      });
      const v2Version = commitRes.data?.file?.version ?? commitRes.data?.version?.version;
      const v2Revision = commitRes.data?.revision ?? commitRes.data?.document?.revision;
      v2Checksum = commitRes.data?.file?.checksum_sha256 ?? commitRes.data?.version?.checksum_sha256;
      if (v2Version !== 2 || v2Checksum !== v2Workbook.sha256 || !v2Revision || v2Revision === v1Revision) {
        if (!webUiAttempted) loopState.steps.webSave = { source: "protocol", status: "FAIL" };
        loopState.details.commit = commitRes.data;
        return finalizeLoopOutcome(
          {
            exitCode: 1,
            status: "FAIL",
            owner: UPSTREAM_BLOCKED_OWNER,
            reason: `commitOfficeFrameVersion did not produce version 2 (got version=${v2Version}, checksum=${v2Checksum})`,
          },
          loopState,
        );
      }
      if (!webUiAttempted) {
        loopState.steps.webSave = {
          source: "protocol",
          status: "PASS",
          reason: webUiRes?.reason ?? "protocol diagnostic commit",
          detail: "protocol diagnostic upload+commit; web UI not driven",
        };
      }
    } else {
      const latestDoc = await callTracerApi({
        apiOrigin,
        fetchImpl,
        name: "openOfficeFrameDocument",
        params: { documentID: documentId },
        token: frameToken,
      });
      v2Checksum = latestDoc.data?.file?.checksum_sha256 ?? v2Workbook.sha256;
    }

    // G710-BE-3 / G710-BE-4 / F2: Fetch the committed v2 workbook bytes from the server,
    // verify the sha256 matches v2Checksum (and differs from v1), and verify the saved XLSX
    // actually contains the expected X/Y/Z cell values before passing v2ContainsExpectedXyz
    // into decideLoop1Outcome.
    const v2ContentRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "getOfficeFrameDocumentContent",
      params: { documentID: documentId },
      token: frameToken,
      expectBinary: true,
    });
    const v2ContentSha256 = sha256Hex(v2ContentRes.bytes);
    const v2BytesSha256Verified = Boolean(
      v2Checksum && v2ContentSha256 === v2Checksum && v2ContentSha256 !== fixture.sha256,
    );
    const editorCellsVerifiedInV2 = verifyXlsxContainsExpectedXyz(
      v2ContentRes.bytes,
      v2Workbook.expectedXyz,
    );
    const v2ContainsExpectedXyz = Boolean(v2BytesSha256Verified && editorCellsVerifiedInV2);
    loopState.details.v2BytesSha256Verified = v2BytesSha256Verified;
    loopState.details.editorCellsVerifiedInV2 = editorCellsVerifiedInV2;
    loopState.details.v2ContainsExpectedXyz = v2ContainsExpectedXyz;
    if (webUiAttempted) {
      loopState.steps.webSave.detail = v2ContainsExpectedXyz
        ? "Playwright typed X/Y/Z cells (E1:G4) through the sheets frame name box and saved v2 via page-level Control+s with focus in the frame; committed v2 bytes and sha256 verified"
        : "page-level Control+s saved v2, but committed v2 bytes did not contain expected X/Y/Z cell values";
      if (webUiDriven && !v2ContainsExpectedXyz) {
        loopState.steps.webSave.status = "FAIL";
      }
    }

    const versionsAfterSaveRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "listDocumentVersions",
      params: { documentID: documentId },
      token,
    });
    const versionsListAfterSave = versionsAfterSaveRes.data?.versions ?? [];
    const versionsAfterSave = versionsListAfterSave.length;
    const v2VersionEntry = versionsListAfterSave.find((v) => Number(v.version) === 2) ?? null;
    loopState.versionCounts.versionsAfterSave = versionsAfterSave;
    loopState.details.v2Sha256 = v2Checksum;
    loopState.details.webUiDriven = webUiDriven;
    loopState.details.webSaveSource = webSaveSource;
    if (webUiError) loopState.details.webUiError = webUiError;

    // 6. Verify workspace change feed (G5-01b/G5-02) delivers the new v2 version (protocol check, F1a / G710-BE-1).
    //    `DocumentChangeListSDO` (`server/internal/handler/document_changes.go:42-70`,
    //    `server/internal/handler/dto/sdo/document_changes.go:7-47`) serializes
    //    `current_version`, `change_kind: "upsert"`, `kind: "file"`, `revision`, `version_id`
    //    (with no `version` or `checksum_sha256` field). We match the SDO fields and cross-check
    //    `version_id` against `listDocumentVersions` v2.
    currentStep = "changeFeed";
    const feedPages = [];
    let feedCursor = initialCursor;
    for (let pageIdx = 0; pageIdx < 10; pageIdx += 1) {
      const feedRes = await callTracerApi({
        apiOrigin,
        fetchImpl,
        name: "listDocumentChanges",
        params: { workspaceID: workspaceId },
        query: feedCursor ? { cursor: feedCursor } : {},
        token,
      });
      feedPages.push(feedRes.data);
      const nextCursor = feedRes.data?.next_cursor ?? "";
      if (!feedRes.data?.has_more || !nextCursor || nextCursor === feedCursor) break;
      feedCursor = nextCursor;
    }
    const hitInFeed = matchDocumentVersionInChangeFeed(feedPages, {
      documentId,
      expectedVersion: 2,
      expectedVersionId: v2VersionEntry?.id ?? "",
      previousRevision: v1Revision,
    });
    const changeFeedDeliveredV2 = Boolean(hitInFeed);
    loopState.steps.changeFeed = {
      source: "protocol",
      status: changeFeedDeliveredV2 ? "PASS" : "FAIL",
    };
    loopState.details.changeFeedDeliveredV2 = changeFeedDeliveredV2;
    loopState.details.changeFeedMatchedItem = hitInFeed ?? null;
    loopState.details.protocolDiagnosticSegment = {
      source: "protocol",
      status: changeFeedDeliveredV2 ? "PASS" : "FAIL",
      summary: "Protocol-level 0-version AI turn + v2 commit + workspace change feed check",
    };

    // 7. Observe the app's own working copy / binding.json reload to v2 via SyncRuntime (G710-L3 / G710-BE-2).
    currentStep = "appReloadV2";
    let appObservedV2ViaFeed = false;
    let appObservedV2Source = "protocol";
    let appV2Binding = null;
    if (appCtrl.signedIn && appCtrl.driven && appOpenedV1 && typeof appCtrl.waitForFeedReloadV2 === "function") {
      const reloaded = await appCtrl.waitForFeedReloadV2({
        documentId,
        wsId: workspaceId,
        token,
        apiOrigin,
        expectedSha256: v2Checksum,
      });
      appObservedV2ViaFeed = Boolean(
        reloaded?.reloaded &&
          Number(reloaded?.binding?.baseVersion ?? 0) === 2 &&
          reloaded?.binding?.state === "saved",
      );
      appObservedV2Source = "app";
      appV2Binding = reloaded?.binding ?? null;
      loopState.steps.appReloadV2 = {
        source: "app",
        status: appObservedV2ViaFeed ? "PASS" : "FAIL",
      };
    } else {
      loopState.steps.appReloadV2 = {
        source: "protocol",
        status: appCtrl.signInFailureReason ? "FAIL" : "BLOCKED",
        reason: appCtrl.signInFailureReason || appCtrl.blockerReason || "app not signed in",
      };
    }
    loopState.details.appObservedV2ViaFeed = appObservedV2ViaFeed;
    loopState.details.appObservedV2Source = appObservedV2Source;
    loopState.details.appV2Binding = appV2Binding;

    // 8. Decide outcome via pure function.
    const decision = decideLoop1Outcome({
      versionsBeforeTurn,
      versionsAfterTurn,
      versionsAfterSave,
      v2ContainsExpectedXyz,
      changeFeedDeliveredV2,
      aiRealUpstream: aiSegment.status === "PASS",
      aiFailureReason: aiSegment.status === "FAIL" ? aiSegment.reason : "",
      webUiDriven,
      webSaveSource,
      webUiError,
      appSignedIn: Boolean(appCtrl.signedIn),
      appDriven: Boolean(appCtrl.driven),
      appOpenedV1,
      appObservedV2ViaFeed,
      appObservedV2Source,
      appSignInFailureReason: appCtrl.signInFailureReason || "",
      desktopBlockReason: appCtrl.blockerReason || "",
    });

    return finalizeLoopOutcome(decision, loopState);
  } catch (err) {
    return recordLoopException(err, loopState, currentStep);
  } finally {
    if (typeof appCtrl?.close === "function") await appCtrl.close();
  }
}

// ---- Loop 2: fx-docx-report-vi (AI edit turn -> 0 versions -> Save in App -> v2) ----

async function runLoop2({
  apiOrigin,
  portsEnv,
  runDir,
  repoRoot,
  fetchImpl = fetch,
  timeoutMs = 20_000,
  appDriver = null,
  cdpConnector = null,
  deepLinkDeliverer = deliverDeepLink,
  watchdogHook = null,
}) {
  const loopState = {
    steps: {
      appOpenV1: { source: "app", status: "PENDING" },
      aiTurn: { source: "protocol", status: "PENDING" },
      saveV2: { source: "protocol", status: "PENDING" },
    },
    versionCounts: {
      versionsBeforeTurn: null,
      versionsAfterTurn: null,
      versionsAfterSave: null,
    },
    details: {
      loop: "2",
      fixtureId: "fx-docx-report-vi",
    },
  };
  let currentStep = "appOpenV1";
  let appCtrl = null;
  if (watchdogHook) {
    watchdogHook.loopState = loopState;
    watchdogHook.getCurrentStep = () => currentStep;
    watchdogHook.getAppCtrl = () => appCtrl;
  }

  try {
    const seeded = await seedFixtureDocument({
      apiOrigin,
      runDir,
      fetchImpl,
      fixtureId: "fx-docx-report-vi",
      repoRoot,
    });
    const { token, userId, workspaceId, documentId, filename } = seeded;
    const docxPair = buildEditedDocxFixtureBytes(repoRoot);
    loopState.details.documentId = documentId;
    loopState.details.workspaceId = workspaceId;
    loopState.details.v1Sha256 = docxPair.v1Sha256;
    loopState.details.v2Sha256 = docxPair.v2Sha256;

    const deploymentId = portsEnv.HARNESS_DEPLOYMENT_ID || HARNESS_DEPLOYMENT_ID;
    appCtrl =
      appDriver ??
      (await connectAppController({
        portsEnv,
        runDir,
        repoRoot,
        apiOrigin,
        fetchImpl,
        token: seeded.token,
        userId: seeded.userId,
        documentId: seeded.documentId,
        deploymentId,
        timeoutMs,
        cdpConnector,
        deepLinkDeliverer,
      }));
    loopState.details.appSignIn = resolveAppSignInForCtrl(appCtrl, seeded.userId);
    loopState.details.appDesktopPrecondition = appCtrl.signedIn
      ? "signed_in"
      : appCtrl.signInFailureReason || appCtrl.blockerReason;

    let appOpenedV1 = false;
    if (appCtrl.signedIn && appCtrl.driven && typeof appCtrl.openDocumentV1 === "function") {
      const opened = await appCtrl.openDocumentV1({ documentId, userId });
      appOpenedV1 = Boolean(opened?.opened && Number(opened?.binding?.baseVersion ?? 0) === 1);
      loopState.steps.appOpenV1 = {
        source: "app",
        status: appOpenedV1 ? "PASS" : "FAIL",
      };
    } else {
      loopState.steps.appOpenV1 = {
        source: "app",
        status: appCtrl.signInFailureReason ? "FAIL" : "BLOCKED",
        reason: appCtrl.signInFailureReason || appCtrl.blockerReason || "app not signed in",
      };
    }
    loopState.details.appOpenedV1 = appOpenedV1;

    // 1. Baseline check before AI turn: version count === 1, revision === v1.
    currentStep = "aiTurn";
    const docBeforeRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "getDocument",
      params: { documentID: documentId },
      token,
    });
    const revisionBefore = docBeforeRes.data?.document?.revision;
    const versionsBeforeRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "listDocumentVersions",
      params: { documentID: documentId },
      token,
    });
    const versionsBeforeTurn = versionsBeforeRes.data?.versions?.length ?? 0;
    loopState.versionCounts.versionsBeforeTurn = versionsBeforeTurn;
    if (versionsBeforeTurn !== 1 || !revisionBefore) {
      loopState.steps.aiTurn = { source: "protocol", status: "FAIL" };
      loopState.details.revisionBefore = revisionBefore;
      return finalizeLoopOutcome(
        {
          exitCode: 1,
          status: "FAIL",
          owner: UPSTREAM_BLOCKED_OWNER,
          reason: `expected 1 version at baseline, got ${versionsBeforeTurn}`,
        },
        loopState,
      );
    }

    // 2. Call the desktop app's document-scoped UniWork AI endpoint (C4: 503 ai_disabled on fake is BLOCKED, not FAIL).
    const aiTurnRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "aiUniworkDocumentChatCompletions",
      params: { documentID: documentId },
      token,
      body: {
        messages: [
          {
            role: "user",
            content:
              "Bổ sung mục 3 Kết luận cho Báo cáo tiến độ quý III bằng tiếng Việt.",
          },
        ],
      },
      allowStatuses: [403, 503],
    });
    const aiEditQualitySegment = classifyAiResponse(aiTurnRes, null, {
      allowRealUpstream: Boolean(
        fetchImpl?.allowRealAiUpstream || process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM === "1",
      ),
    });
    loopState.details.aiEditQualitySegment = aiEditQualitySegment;

    // 3. G6-A03 early evidence: verify the AI turn created 0 server versions,
    //    did not advance document.revision, and created no commit intent on server or in app.
    const versionsAfterTurnRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "listDocumentVersions",
      params: { documentID: documentId },
      token,
    });
    const versionsAfterTurn = versionsAfterTurnRes.data?.versions?.length ?? 0;
    loopState.versionCounts.versionsAfterTurn = versionsAfterTurn;

    const docAfterTurnRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "getDocument",
      params: { documentID: documentId },
      token,
    });
    const revisionAfterTurn = docAfterTurnRes.data?.document?.revision;

    const commitKey = `g710-loop2-${documentId}-v2`;
    const intentBeforeSaveRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "lookupCommitIntent",
      params: { documentID: documentId },
      token,
      headers: { "Idempotency-Key": commitKey },
      allowStatuses: [410],
    });
    const commitIntentBeforeSave = interpretCommitIntentLookup(intentBeforeSaveRes);
    loopState.details.commitIntentBeforeSave = commitIntentBeforeSave;

    const appIntentsAfterTurn = listAppSyncIntentFiles(
      portsEnv.UNIWORK_USER_DATA,
      deploymentId,
      userId,
    ).length;
    loopState.details.appIntentsAfterTurn = appIntentsAfterTurn;

    const preSaveIntentClean =
      !commitIntentBeforeSave.hasCommitted &&
      (commitIntentBeforeSave.outcome === "unknown" || commitIntentBeforeSave.outcome === "not_committed");

    if (
      versionsAfterTurn !== 1 ||
      revisionAfterTurn !== revisionBefore ||
      !preSaveIntentClean ||
      appIntentsAfterTurn > 0
    ) {
      loopState.steps.aiTurn = { source: "protocol", status: "FAIL" };
      loopState.details.revisionBefore = revisionBefore;
      loopState.details.revisionAfterTurn = revisionAfterTurn;
      return finalizeLoopOutcome(
        {
          exitCode: 1,
          status: "FAIL",
          owner: UPSTREAM_BLOCKED_OWNER,
          reason: `G6-A03 violation: AI turn created a version or save intent before explicit Save (versions=${versionsAfterTurn}, revision=${revisionAfterTurn}, intent=${commitIntentBeforeSave.outcome}, appIntents=${appIntentsAfterTurn})`,
        },
        loopState,
      );
    }

    loopState.steps.aiTurn = {
      source: "protocol",
      status: aiEditQualitySegment.status,
      httpStatus: aiTurnRes.status,
      reason: aiEditQualitySegment.reason ?? "",
    };
    loopState.details.noAutoSaveSegment = {
      source: "protocol",
      status: "PASS",
      summary: "G6-A03 invariant verified: AI turn created 0 versions/intents; explicit Save creates version 2",
    };

    // 4. Drive explicit Save of the edited DOCX: in the real app via CDP if signed in,
    //    else run the protocol diagnostic commit (`saveSource: "protocol"`).
    currentStep = "saveV2";
    let appSavedV2 = false;
    let saveSource = "protocol";
    let commitIntentOutcome = "unknown";

    if (appCtrl.signedIn && appCtrl.driven && appOpenedV1 && typeof appCtrl.saveOnlineInApp === "function") {
      saveSource = "app";
      loopState.steps.saveV2 = { source: "app", status: "PENDING" };
      const saved = await appCtrl.saveOnlineInApp({
        documentId,
        v2Bytes: docxPair.v2Bytes,
        expectedSha256: docxPair.v2Sha256,
      });
      appSavedV2 = Boolean(saved?.saved && Number(saved?.binding?.baseVersion ?? 0) === 2);
      if (saved?.idempotencyKey) {
        const intentAfterAppSaveRes = await callTracerApi({
          apiOrigin,
          fetchImpl,
          name: "lookupCommitIntent",
          params: { documentID: documentId },
          token,
          headers: { "Idempotency-Key": saved.idempotencyKey },
          allowStatuses: [410],
        });
        const commitIntentAfterSave = interpretCommitIntentLookup(intentAfterAppSaveRes);
        loopState.details.commitIntentAfterSave = commitIntentAfterSave;
        loopState.details.commitIntentReceiptSource = "endpoint_lookup";
        commitIntentOutcome = commitIntentAfterSave.outcome;
      } else {
        loopState.details.commitIntentReceiptSource = "binding_and_version_read";
        commitIntentOutcome = appSavedV2 ? "committed" : "not_committed";
      }
      loopState.steps.saveV2 = {
        source: "app",
        status: appSavedV2 && commitIntentOutcome === "committed" ? "PASS" : "FAIL",
      };
    } else {
      saveSource = "protocol";
      loopState.steps.saveV2 = { source: "protocol", status: "PENDING" };
      const uploadForm = new FormData();
      uploadForm.append("file", new Blob([docxPair.v2Bytes]), filename);
      const uploadRes = await callTracerApi({
        apiOrigin,
        fetchImpl,
        name: "uploadDocumentFile",
        params: { documentID: documentId },
        token,
        form: uploadForm,
      });
      const uploadId = uploadRes.data?.upload_id;
      if (!uploadId || uploadRes.data?.checksum_sha256 !== docxPair.v2Sha256) {
        loopState.steps.saveV2 = { source: "protocol", status: "FAIL" };
        loopState.details.upload = uploadRes.data;
        loopState.details.expectedSha256 = docxPair.v2Sha256;
        return finalizeLoopOutcome(
          {
            exitCode: 1,
            status: "FAIL",
            owner: UPSTREAM_BLOCKED_OWNER,
            reason: "uploadDocumentFile failed or returned wrong sha256",
          },
          loopState,
        );
      }

      const commitRes = await callTracerApi({
        apiOrigin,
        fetchImpl,
        name: "commitDocumentVersion",
        params: { documentID: documentId },
        token,
        headers: { "Idempotency-Key": commitKey },
        body: { upload_id: uploadId, base_revision: revisionBefore },
      });
      const v2Version = commitRes.data?.version?.version;
      const v2Revision = commitRes.data?.document?.revision;
      if (v2Version !== 2 || !v2Revision || v2Revision === revisionBefore) {
        loopState.steps.saveV2 = { source: "protocol", status: "FAIL" };
        loopState.details.commit = commitRes.data;
        return finalizeLoopOutcome(
          {
            exitCode: 1,
            status: "FAIL",
            owner: UPSTREAM_BLOCKED_OWNER,
            reason: `commitDocumentVersion did not create version 2 (got version=${v2Version})`,
          },
          loopState,
        );
      }
      const intentAfterSaveRes = await callTracerApi({
        apiOrigin,
        fetchImpl,
        name: "lookupCommitIntent",
        params: { documentID: documentId },
        token,
        headers: { "Idempotency-Key": commitKey },
        allowStatuses: [410],
      });
      const commitIntentAfterSave = interpretCommitIntentLookup(intentAfterSaveRes);
      loopState.details.commitIntentAfterSave = commitIntentAfterSave;
      commitIntentOutcome = commitIntentAfterSave.outcome;
      loopState.steps.saveV2 = {
        source: "protocol",
        status: commitIntentOutcome === "committed" ? "PASS" : "FAIL",
      };
    }

    const versionsAfterSaveRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "listDocumentVersions",
      params: { documentID: documentId },
      token,
    });
    const versionsAfterSave = versionsAfterSaveRes.data?.versions?.length ?? 0;
    loopState.versionCounts.versionsAfterSave = versionsAfterSave;
    loopState.details.commitIntentOutcome = commitIntentOutcome;
    loopState.details.saveSource = saveSource;
    loopState.details.appSavedV2 = appSavedV2;

    const decision = decideLoop2Outcome({
      versionsBeforeTurn,
      versionsAfterTurn,
      versionsAfterSave,
      commitIntentOutcome,
      aiRealUpstream: aiEditQualitySegment.status === "PASS",
      aiFailureReason: aiEditQualitySegment.status === "FAIL" ? aiEditQualitySegment.reason : "",
      appSignedIn: Boolean(appCtrl.signedIn),
      appDriven: Boolean(appCtrl.driven),
      appOpenedV1,
      appIntentsAfterTurn,
      appSavedV2,
      saveSource,
      appSignInFailureReason: appCtrl.signInFailureReason || "",
      desktopBlockReason: appCtrl.blockerReason || "",
    });

    return finalizeLoopOutcome(decision, loopState);
  } catch (err) {
    return recordLoopException(err, loopState, currentStep);
  } finally {
    if (typeof appCtrl?.close === "function") await appCtrl.close();
  }
}

// ---- Loop 3: fx-docx-report-vi (Offline Save in App -> Reconnect -> Receipt) ----

async function runLoop3({
  apiOrigin,
  portsEnv,
  runDir,
  repoRoot,
  fetchImpl = fetch,
  timeoutMs = 20_000,
  spawnAppHook = null,
  appDriver = null,
  cdpConnector = null,
  deepLinkDeliverer = deliverDeepLink,
  watchdogHook = null,
}) {
  const loopState = {
    steps: {
      appOfflineSave: { source: "app", status: "PENDING" },
      protocolReconnectDiagnostic: { source: "protocol", status: "PENDING" },
    },
    versionCounts: {
      versionsBeforeCut: 1,
      serverVersionsWhileCut: null,
      serverVersionsAfterReconnect: null,
      versionsAfterIdempotentRetry: null,
    },
    details: {
      loop: "3",
      fixtureId: "fx-docx-report-vi",
    },
  };
  let currentStep = "appOfflineSave";
  let seeded = null;
  let appCtrl = null;
  if (watchdogHook) {
    watchdogHook.loopState = loopState;
    watchdogHook.getCurrentStep = () => currentStep;
    watchdogHook.getAppCtrl = () => appCtrl;
  }

  try {
    seeded = await seedFixtureDocument({
      apiOrigin,
      runDir,
      fetchImpl,
      fixtureId: "fx-docx-report-vi",
      repoRoot,
    });
    const { token, userId, workspaceId, documentId, filename } = seeded;
    const docxPair = buildEditedDocxFixtureBytes(repoRoot);
    loopState.details.documentId = documentId;
    loopState.details.workspaceId = workspaceId;

    const deploymentId = portsEnv.HARNESS_DEPLOYMENT_ID || HARNESS_DEPLOYMENT_ID;
    appCtrl =
      appDriver ??
      (await connectAppController({
        portsEnv,
        runDir,
        repoRoot,
        apiOrigin,
        fetchImpl,
        token: seeded.token,
        userId: seeded.userId,
        documentId: seeded.documentId,
        deploymentId,
        timeoutMs,
        cdpConnector,
        deepLinkDeliverer,
      }));
    loopState.details.appSignIn = resolveAppSignInForCtrl(appCtrl, seeded.userId);
    loopState.details.appDesktopPrecondition = appCtrl.signedIn
      ? "signed_in"
      : appCtrl.signInFailureReason || appCtrl.blockerReason;

    // If a legacy r1 spawnAppHook was supplied (which only writes binding.json at v2
    // without driving the app through v1 -> proxy cut -> offline intent -> reconnect),
    // execute it and pass `testCommittedBeforeApp: true, commitSource: "protocol"` to
    // decideLoop3Outcome so it is caught and rejected as FAIL (exit 1), never PASS (G710-L2).
    if (typeof spawnAppHook === "function") {
      await spawnAppHook({ deepLink: "", documentId, userId });
      const wc = inspectWorkingCopy({
        userDataDir: portsEnv.UNIWORK_USER_DATA,
        deploymentId,
        documentId,
        expectedUserId: userId,
      });
      const decision = decideLoop3Outcome({
        appSignedIn: true,
        appDriven: true,
        appOpenedV1: false,
        appHeldOfflineIntentWhileCut: false,
        serverVersionsWhileCut: 1,
        testCommittedBeforeApp: true,
        commitSource: "protocol",
        appBindingAfterReconnect: wc.binding,
        appIntentsAfterReconnect: 0,
        serverVersionsAfterReconnect: 1,
      });
      loopState.steps.appOfflineSave = { source: "app", status: "FAIL", reason: decision.reason };
      loopState.details.appReceiptSegment = {
        source: "app",
        status: "FAIL",
        reason: decision.reason,
      };
      return finalizeLoopOutcome(decision, loopState);
    }

    // When the app is signed in and its Save can be driven headlessly (via CDP or appDriver):
    // 1. Open v1 in the app first (`binding.json` settles at `baseVersion: 1`).
    // 2. Cut the app's proxy link (`setAppApiProxyOnline(runDir, false)`), save v2 in the app
    //    while cut, and verify from the app's own state that `binding.json` is `offline`
    //    (or `.rec` intent exists in `uniwork-sync/store/.../intents/`) while the server
    //    still has 1 version (`serverVersionsWhileCut === 1`).
    // 3. Resume the app's proxy link (`setAppApiProxyOnline(runDir, true)`), flush the app's
    //    save, and verify `binding.json` settles to `state: "saved", baseVersion: 2`,
    //    the `.rec` intent is cleared, and the server has 2 versions.
    if (appCtrl.signedIn && appCtrl.driven) {
      const opened = await appCtrl.openDocumentV1({ documentId, userId });
      const appOpenedV1 = Boolean(opened?.opened && Number(opened?.binding?.baseVersion ?? 0) === 1);
      loopState.details.appOpenedV1 = appOpenedV1;

      const cutRes = await appCtrl.saveOfflineWhileCut({
        documentId,
        v2Bytes: docxPair.v2Bytes,
        v2Sha256: docxPair.v2Sha256,
      });
      const versionsWhileCutRes = await callTracerApi({
        apiOrigin,
        fetchImpl,
        name: "listDocumentVersions",
        params: { documentID: documentId },
        token,
      });
      const serverVersionsWhileCut = versionsWhileCutRes.data?.versions?.length ?? 0;
      loopState.versionCounts.serverVersionsWhileCut = serverVersionsWhileCut;
      const bindingWhileCut = cutRes?.bindingWhileCut ?? null;
      const intentFilesWhileCut = cutRes?.intentFilesWhileCut ?? [];
      const bindingAtV1WhileCut = Boolean(
        bindingWhileCut && Number(bindingWhileCut.baseVersion ?? 0) === 1,
      );
      const appHeldOfflineIntentWhileCut = Boolean(
        bindingAtV1WhileCut &&
          (bindingWhileCut.state === "offline" ||
            bindingWhileCut.state === "paused_offline" ||
            intentFilesWhileCut.length > 0),
      );
      loopState.details.serverVersionsWhileCut = serverVersionsWhileCut;
      loopState.details.appHeldOfflineIntentWhileCut = appHeldOfflineIntentWhileCut;
      loopState.details.intentFilesWhileCut = intentFilesWhileCut;

      const reconRes = await appCtrl.reconnectAndFlushSave({
        apiOrigin,
        token,
        documentId,
        v2Bytes: docxPair.v2Bytes,
        expectedSha256: docxPair.v2Sha256,
      });
      const versionsAfterReconnectRes = await callTracerApi({
        apiOrigin,
        fetchImpl,
        name: "listDocumentVersions",
        params: { documentID: documentId },
        token,
      });
      const serverVersionsAfterReconnect = versionsAfterReconnectRes.data?.versions?.length ?? 0;
      loopState.versionCounts.serverVersionsAfterReconnect = serverVersionsAfterReconnect;
      loopState.details.serverVersionsAfterReconnect = serverVersionsAfterReconnect;
      const bindingAfterReconnect = reconRes?.bindingAfterReconnect ?? null;
      const intentFilesAfterReconnect = reconRes?.intentFilesAfterReconnect ?? [];

      const decision = decideLoop3Outcome({
        appSignedIn: true,
        appDriven: true,
        appOpenedV1,
        appHeldOfflineIntentWhileCut,
        serverVersionsWhileCut,
        testCommittedBeforeApp: false,
        commitSource: "app",
        appBindingAfterReconnect: bindingAfterReconnect,
        appIntentsAfterReconnect: intentFilesAfterReconnect.length,
        serverVersionsAfterReconnect,
      });

      loopState.steps.appOfflineSave = {
        source: "app",
        status: decision.status,
        ...(decision.status !== "PASS" ? { reason: decision.reason } : {}),
      };
      loopState.steps.protocolReconnectDiagnostic = {
        source: "protocol",
        status: "SKIPPED",
        reason: "app offline save was driven directly",
      };
      loopState.details.appReceiptSegment = {
        status: decision.status,
        source: "app",
        baseVersion: bindingAfterReconnect?.baseVersion ?? null,
        baseRevision: bindingAfterReconnect?.baseRevision ?? null,
        baseVersionId: bindingAfterReconnect?.baseVersionId ?? null,
        baseChecksum: bindingAfterReconnect?.baseChecksum ?? null,
        state: bindingAfterReconnect?.state ?? null,
      };

      return finalizeLoopOutcome(decision, loopState);
    }

    loopState.steps.appOfflineSave = {
      source: "app",
      status: appCtrl.signInFailureReason ? "FAIL" : "BLOCKED",
      reason: appCtrl.signInFailureReason || appCtrl.blockerReason || "app not signed in",
    };

    // Otherwise, the app is not signed in or cannot be driven headlessly on this VM.
    // Run the server-side G5-06 idempotent commit/receipt diagnostic ONLY as `source: "protocol"`
    // AFTER confirming the app is blocked, and return `BLOCKED` (exit 77, owner `g7-qa`), never `PASS`.
    currentStep = "protocolReconnectDiagnostic";
    const docBefore = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "getDocument",
      params: { documentID: documentId },
      token,
    });
    const v1Revision = docBefore.data?.document?.revision;
    const offlineIntentKey = `g710-loop3-offline-${documentId}`;

    const lookupWhileOfflineRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "lookupCommitIntent",
      params: { documentID: documentId },
      token,
      headers: { "Idempotency-Key": offlineIntentKey },
      allowStatuses: [410],
    });
    const lookupWhileOffline = interpretCommitIntentLookup(lookupWhileOfflineRes);
    loopState.details.lookupWhileOffline = lookupWhileOffline;
    if (
      lookupWhileOffline.hasCommitted ||
      (lookupWhileOffline.outcome !== "unknown" && lookupWhileOffline.outcome !== "not_committed")
    ) {
      loopState.steps.protocolReconnectDiagnostic = { source: "protocol", status: "FAIL" };
      return finalizeLoopOutcome(
        {
          exitCode: 1,
          status: "FAIL",
          owner: UPSTREAM_BLOCKED_OWNER,
          reason: `expected lookupCommitIntent before reconnect to be unknown (410) or not_committed (200), got httpStatus=${lookupWhileOffline.httpStatus}, outcome=${lookupWhileOffline.outcome}`,
        },
        loopState,
      );
    }

    const uploadForm = new FormData();
    uploadForm.append("file", new Blob([docxPair.v2Bytes]), filename);
    const uploadRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "uploadDocumentFile",
      params: { documentID: documentId },
      token,
      form: uploadForm,
    });
    const uploadId = uploadRes.data?.upload_id;

    const commitRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "commitDocumentVersion",
      params: { documentID: documentId },
      token,
      headers: { "Idempotency-Key": offlineIntentKey },
      body: { upload_id: uploadId, base_revision: v1Revision },
    });
    const v2VersionId = commitRes.data?.version?.id;
    const v2Version = commitRes.data?.version?.version;
    const v2Revision = commitRes.data?.document?.revision;

    const lookupAfterReconnectRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "lookupCommitIntent",
      params: { documentID: documentId },
      token,
      headers: { "Idempotency-Key": offlineIntentKey },
      allowStatuses: [410],
    });
    const lookupAfterReconnect = interpretCommitIntentLookup(lookupAfterReconnectRes);
    loopState.details.lookupAfterReconnect = lookupAfterReconnect;

    const retryCommitRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "commitDocumentVersion",
      params: { documentID: documentId },
      token,
      headers: { "Idempotency-Key": offlineIntentKey },
      body: { upload_id: uploadId, base_revision: v1Revision },
    });

    const versionsAfterRetryRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "listDocumentVersions",
      params: { documentID: documentId },
      token,
    });
    const versionsAfterIdempotentRetry = versionsAfterRetryRes.data?.versions?.length ?? 0;
    loopState.versionCounts.versionsAfterIdempotentRetry = versionsAfterIdempotentRetry;

    if (
      v2Version !== 2 ||
      lookupAfterReconnect.outcome !== "committed" ||
      lookupAfterReconnect.version !== 2 ||
      lookupAfterReconnect.versionId !== v2VersionId ||
      retryCommitRes.data?.version?.id !== v2VersionId ||
      versionsAfterIdempotentRetry !== 2
    ) {
      loopState.steps.protocolReconnectDiagnostic = { source: "protocol", status: "FAIL" };
      loopState.details.commit = commitRes.data;
      return finalizeLoopOutcome(
        {
          exitCode: 1,
          status: "FAIL",
          owner: UPSTREAM_BLOCKED_OWNER,
          reason: `G5-06 offline reconnect receipt reconciliation failed (v2Version=${v2Version}, outcome=${lookupAfterReconnect.outcome}, versionsAfterRetry=${versionsAfterIdempotentRetry})`,
        },
        loopState,
      );
    }

    const protocolDiagnosticSegment = {
      source: "protocol",
      status: "PASS",
      versionId: v2VersionId,
      version: v2Version,
      revision: v2Revision,
      versionsAfterIdempotentRetry,
    };
    loopState.steps.protocolReconnectDiagnostic = { source: "protocol", status: "PASS" };
    loopState.details.protocolDiagnosticSegment = protocolDiagnosticSegment;

    const decision = decideLoop3Outcome({
      appSignedIn: Boolean(appCtrl.signedIn),
      appDriven: Boolean(appCtrl.driven),
      appOpenedV1: false,
      appHeldOfflineIntentWhileCut: false,
      serverVersionsWhileCut: 1,
      testCommittedBeforeApp: false,
      commitSource: "protocol",
      appSignInFailureReason: appCtrl.signInFailureReason || "",
      desktopBlockReason: appCtrl.blockerReason || "",
    });
    loopState.details.appReceiptSegment = {
      status: decision.status,
      source: "app",
      reason: decision.reason,
    };

    return finalizeLoopOutcome(decision, loopState);
  } catch (err) {
    return recordLoopException(err, loopState, currentStep);
  } finally {
    setAppApiProxyOnline(runDir, true);
    if (typeof appCtrl?.close === "function") await appCtrl.close();
    if (seeded) await cleanupSeededOrganization({ apiOrigin, fetchImpl, seeded, runDir });
  }
}

// ---- Entrypoint & Loop Router ------------------------------------------------

const LOOP_ALIASES = Object.freeze({
  "1": "1",
  "xlsx-web-to-app": "1",
  "2": "2",
  "docx-ai-save-app": "2",
  "3": "3",
  "docx-offline-save-app": "3",
});

export function parseArgs(argv) {
  const out = {
    loop: "1",
    runDir: process.env.HARNESS_RUN_DIR || resolve(DEFAULT_REPO_ROOT, ".harness-run"),
    timeoutMs: Number(process.env.HARNESS_DOC_TIMEOUT_MS || 45_000),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--loop") {
      const raw = argv[++i];
      const mapped = LOOP_ALIASES[raw];
      if (!mapped) {
        throw new Error(
          `unknown --loop "${raw}" (expected 1|2|3|xlsx-web-to-app|docx-ai-save-app|docx-offline-save-app)`,
        );
      }
      out.loop = mapped;
    } else if (a === "--run-dir") {
      out.runDir = resolve(argv[++i]);
    } else if (a === "--timeout-ms") {
      out.timeoutMs = Number(argv[++i]);
    } else if (a === "-h" || a === "--help") {
      out.help = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return out;
}

export async function runTracerLoop({
  loop,
  runDir,
  repoRoot = DEFAULT_REPO_ROOT,
  fetchImpl = fetch,
  timeoutMs = 45_000,
  loopTimeoutMs = null,
  spawnAppHook = null,
  webDriver = null,
  appDriver = null,
  cdpConnector = null,
  deepLinkDeliverer = deliverDeepLink,
}) {
  const normalized = LOOP_ALIASES[String(loop)] ?? String(loop);
  const defaultAppSignIn = buildSanitizedAppSignInRecord({
    appStarted: false,
    cdpAttempted: false,
    cdpConnected: false,
    keyringAvailable: null,
    accountState: "not-started",
    sessionBinExists: false,
  });
  const startStatus = readStartStatus(runDir);
  const gate = startGate(startStatus);
  if (gate.gate !== "proceed") {
    const blocked = gate.gate === "blocked";
    return {
      exitCode: blocked ? BLOCKED_EXIT : 1,
      status: blocked ? "BLOCKED" : "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: gate.reason,
      appSignIn: defaultAppSignIn,
      steps: {},
      versionCounts: {},
      details: { owner: UPSTREAM_BLOCKED_OWNER, loop: normalized, startStatus, appSignIn: defaultAppSignIn },
    };
  }

  const portsEnvPath = join(runDir, "ports.env");
  if (!existsSync(portsEnvPath)) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `no ports.env in ${runDir} (run scripts/office/g5g6g7/harness/start.sh first)`,
      appSignIn: defaultAppSignIn,
      steps: {},
      versionCounts: {},
      details: { owner: UPSTREAM_BLOCKED_OWNER, loop: normalized, appSignIn: defaultAppSignIn },
    };
  }
  const portsEnv = parseEnvFile(readFileSync(portsEnvPath, "utf8"));
  const apiOrigin = portsEnv.API_ORIGIN;
  if (!apiOrigin) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `API_ORIGIN missing from ${portsEnvPath}`,
      appSignIn: defaultAppSignIn,
      steps: {},
      versionCounts: {},
      details: { owner: UPSTREAM_BLOCKED_OWNER, loop: normalized, appSignIn: defaultAppSignIn },
    };
  }

  if (normalized !== "1" && normalized !== "2" && normalized !== "3") {
    return {
      exitCode: 2,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: `unsupported loop "${loop}"`,
      appSignIn: defaultAppSignIn,
      steps: {},
      versionCounts: {},
      details: { owner: UPSTREAM_BLOCKED_OWNER, loop: normalized, appSignIn: defaultAppSignIn },
    };
  }

  const watchdogHook = {
    loopState: null,
    getCurrentStep: () => "",
    getAppCtrl: () => null,
  };
  const effectiveLoopTimeoutMs = resolveLoopTimeoutMs(loopTimeoutMs, portsEnv);
  let watchdogTimer = null;

  const runSelectedLoop = async () => {
    if (normalized === "1") {
      return runLoop1({
        apiOrigin,
        portsEnv,
        runDir,
        repoRoot,
        fetchImpl,
        timeoutMs,
        webDriver,
        appDriver,
        cdpConnector,
        deepLinkDeliverer,
        watchdogHook,
      });
    }
    if (normalized === "2") {
      return runLoop2({
        apiOrigin,
        portsEnv,
        runDir,
        repoRoot,
        fetchImpl,
        timeoutMs,
        appDriver,
        cdpConnector,
        deepLinkDeliverer,
        watchdogHook,
      });
    }
    return runLoop3({
      apiOrigin,
      portsEnv,
      runDir,
      repoRoot,
      fetchImpl,
      timeoutMs,
      spawnAppHook,
      appDriver,
      cdpConnector,
      deepLinkDeliverer,
      watchdogHook,
    });
  };

  try {
    return await Promise.race([
      runSelectedLoop(),
      new Promise((resolveWatchdog) => {
        watchdogTimer = setTimeout(() => {
          try {
            setAppApiProxyOnline(runDir, true);
          } catch {
            // ignore cleanup errors on watchdog expiry
          }
          const liveCtrl = watchdogHook.getAppCtrl?.();
          if (typeof liveCtrl?.close === "function") {
            Promise.resolve()
              .then(() => liveCtrl.close())
              .catch(() => {});
          }
          const liveState = watchdogHook.loopState ?? {
            steps: {},
            versionCounts: {},
            details: { loop: normalized, appSignIn: defaultAppSignIn },
          };
          const activeStep = watchdogHook.getCurrentStep?.() || "";
          if (activeStep && liveState.steps?.[activeStep]) {
            liveState.steps[activeStep] = {
              ...liveState.steps[activeStep],
              status: "FAIL",
              reason: "loop watchdog",
            };
          }
          liveState.details.appLogTail = readRedactedAppLogTail(runDir, APP_LOG_TAIL_LINES);
          const watchdogRes = finalizeLoopOutcome(
            {
              exitCode: 1,
              status: "FAIL",
              owner: UPSTREAM_BLOCKED_OWNER,
              reason: "loop watchdog",
            },
            liveState,
          );
          try {
            mkdirSync(runDir, { recursive: true });
            writeFileSync(
              join(runDir, `tracer-loop-${normalized}.json`),
              `${JSON.stringify(watchdogRes, null, 2)}\n`,
            );
          } catch {
            // ignore write error if runDir was already removed
          }
          resolveWatchdog(watchdogRes);
        }, effectiveLoopTimeoutMs);
      }),
    ]);
  } catch (err) {
    return {
      exitCode: 1,
      status: "FAIL",
      owner: UPSTREAM_BLOCKED_OWNER,
      reason: err instanceof Error ? err.message : String(err),
      appSignIn: defaultAppSignIn,
      steps: {},
      versionCounts: {},
      details: { owner: UPSTREAM_BLOCKED_OWNER, loop: normalized, appSignIn: defaultAppSignIn },
    };
  } finally {
    if (watchdogTimer !== null) clearTimeout(watchdogTimer);
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "usage: tracer.mjs --loop <1|2|3|xlsx-web-to-app|docx-ai-save-app|docx-offline-save-app> [--run-dir <dir>] [--timeout-ms <ms>]",
    );
    return;
  }
  const defaultReq = args.loop === "3" ? "G5-A05" : args.loop === "2" ? "G6-A03" : "G5-A03";
  const defaultFixture = args.loop === "1" ? "fx-xlsx-revenue-xyz" : "fx-docx-report-vi";
  const reqId = process.env.OFFICE_EVIDENCE_REQ || defaultReq;
  const fixId = process.env.OFFICE_EVIDENCE_FIXTURE || defaultFixture;
  const command = `node scripts/office/g5g6g7/g7-10/tracer.mjs --loop ${args.loop} --run-dir ${args.runDir}`;

  // Truncate/replace `tracer-loop-N.json` at loop start so warm VMs never retain a
  // stale JSON object from an earlier round (F4).
  mkdirSync(args.runDir, { recursive: true });
  const artifactPath = join(args.runDir, `tracer-loop-${args.loop}.json`);
  rmSync(artifactPath, { force: true });

  const startedGate = startGate(readStartStatus(args.runDir));
  if (startedGate.gate !== "proceed") {
    const exitCode = await concludeAtStartGate(startedGate, {
      runDir: args.runDir,
      requirementId: reqId,
      fixtureId: fixId,
      command,
      checker: "harness:g7-10/tracer.mjs",
      startedAt,
      argv: [...process.argv],
    });
    process.exit(exitCode);
  }
  const res = await runTracerLoop({
    loop: args.loop,
    runDir: args.runDir,
    timeoutMs: args.timeoutMs,
  });

  writeFileSync(artifactPath, `${JSON.stringify(res, null, 2)}\n`);

  if (!process.env.OFFICE_EVIDENCE_ID) {
    const paths = harnessPaths(args.runDir);
    const portsText = existsSync(paths.envFile) ? readFileSync(paths.envFile, "utf8") : "";
    const forkSha = process.env.OFFICE_FORK_SHA || parseEnvFile(portsText).OFFICE_FORK_SHA || "";
    const line = evidenceLine({
      evidenceId: harnessEvidenceId(reqId),
      ...(await ledgerIdentity()),
      requirementId: reqId,
      fixtureId: fixId,
      fixtureSha256: await fixtureSha256Of(fixId),
      fSha: forkSha,
      platform: `${process.platform}-${process.arch}`,
      build: `node ${process.versions.node}`,
      command,
      argv: [...process.argv],
      exitCode: res.exitCode,
      result: res.status,
      artifact: artifactPath,
      checker: "harness:g7-10/tracer.mjs",
      blocker: res.status === "BLOCKED" ? res.reason : "",
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    appendFileSync(paths.evidenceFile, `${JSON.stringify(line)}\n`);
  }

  console.log(JSON.stringify(res, null, 2));
  if (res.status === "BLOCKED") {
    console.error(`BLOCKED: ${res.reason}`);
  } else if (res.status !== "PASS") {
    console.error(`FAILED: ${res.reason}`);
  }
  process.exit(res.exitCode);
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error(`tracer.mjs: ${err.message}`);
    process.exit(1);
  });
}
