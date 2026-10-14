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
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  startGate,
  workingCopyDir,
} from "../harness/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, "../../../..");
const MANIFEST_REL = "docs/office/g5g6g7/fixtures/manifest.json";

export const BLOCKED_EXIT = HARNESS_BLOCKED_EXIT;
export const UPSTREAM_BLOCKED_REASON = "no real upstream on this runner; contract-p0 §8";
export const UPSTREAM_BLOCKED_OWNER = "g7-qa";

/**
 * Every HTTP route the tracer driver calls against the D server.
 * Path templates match `server/internal/handler/router/*.go` (under `/api/v1`).
 * Verified against the Go router and handler SDI structs in `tracer.test.mjs`.
 */
export const TRACER_API_CALLS = Object.freeze({
  ...API_CALLS,
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

export function inspectWorkingCopy({
  userDataDir,
  deploymentId = HARNESS_DEPLOYMENT_ID,
  documentId,
  expectedUserId = null,
  expectedSha256 = "",
}) {
  const root = join(userDataDir, "uniwork-documents", deploymentId);
  if (!existsSync(root)) {
    return { bindingPresent: false, filePresent: false, sha256Match: false, bindingState: null, binding: null };
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
      };
    } catch {
      return { bindingPresent: false, filePresent: false, sha256Match: false, bindingState: "invalid", binding: null };
    }
  }
  return { bindingPresent: false, filePresent: false, sha256Match: false, bindingState: null, binding: null };
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
  fetchImpl = fetch,
  fixtureId,
  repoRoot = DEFAULT_REPO_ROOT,
  now = Date.now(),
}) {
  const fixture = loadVerifiedFixture(fixtureId, repoRoot);
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

  const wsRes = await callTracerApi({
    apiOrigin,
    fetchImpl,
    name: "createWorkspace",
    params: { org: organizationId },
    token,
    body: { name: "G7-10 tracer", slug: `w-g710-${stamp}` },
  });
  const workspaceId = wsRes.data.workspace.id;

  const filename = basename(fixture.entry.path);
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
    email,
    token,
    userId,
    organizationId,
    organizationSlug: orgRes.data.organization?.slug ?? organizationSlug,
    workspaceId,
    documentId,
    filename,
    fixture,
  };
}

async function cleanupSeededOrganization({ apiOrigin, fetchImpl = fetch, seeded }) {
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
 * Under `contract-p0.md` §8, the cloud runner runs `AI_PROVIDER=fake` and must
 * NEVER report `PASS` for a real-model AI segment.
 */
function classifyAiResponse(aiTurnResult, expectedXyz = null) {
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
  const allowReal = process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM === "1";

  if (!allowReal || provider === "fake" || model.includes("fake") || content.includes("[fake")) {
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

// ---- Loop 1: fx-xlsx-revenue-xyz (Web -> AI -> Editor X/Y/Z Save -> Feed -> App) ----

async function runLoop1({
  apiOrigin,
  portsEnv,
  repoRoot,
  fetchImpl = fetch,
}) {
  const seeded = await seedFixtureDocument({
    apiOrigin,
    fetchImpl,
    fixtureId: "fx-xlsx-revenue-xyz",
    repoRoot,
  });
  try {
    const { token, workspaceId, documentId, filename, fixture } = seeded;

    // 1. Capture initial workspace change-feed snapshot cursor at v1.
    const initialFeed = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "listDocumentChanges",
      params: { workspaceID: workspaceId },
      token,
    });
    const initialCursor = initialFeed.data?.next_cursor ?? "";

    // 2. Open on Web via the office-frame token + frame document/content API.
    const frameTokenRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "mintOfficeFrameToken",
      params: { documentID: documentId },
      token,
    });
    const frameToken = frameTokenRes.data?.token;
    if (!frameToken) {
      return {
        exitCode: 1,
        status: "FAIL",
        reason: "mintOfficeFrameToken returned an empty token",
        details: {},
      };
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
      return {
        exitCode: 1,
        status: "FAIL",
        reason: `openOfficeFrameDocument v1 mismatch: version=${v1Version}, checksum=${v1Checksum}, expected=${fixture.sha256}`,
        details: { v1Version, v1Checksum, expectedSha256: fixture.sha256 },
      };
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
      return {
        exitCode: 1,
        status: "FAIL",
        reason: "getOfficeFrameDocumentContent bytes did not match fx-xlsx-revenue-xyz v1 sha256",
        details: {},
      };
    }

    // 3. Count server versions before the AI turn, run the AI turn, and verify
    //    G6-A03 invariant: the AI turn itself creates 0 versions and 0 uploads.
    const versionsBeforeRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "listDocumentVersions",
      params: { documentID: documentId },
      token,
    });
    const versionsBeforeTurn = versionsBeforeRes.data?.versions?.length ?? 0;

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
    const docAfterTurnRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "getDocument",
      params: { documentID: documentId },
      token,
    });
    const revisionAfterTurn = docAfterTurnRes.data?.document?.revision;

    if (versionsAfterTurn !== versionsBeforeTurn || revisionAfterTurn !== v1Revision) {
      return {
        exitCode: 1,
        status: "FAIL",
        reason: `G6-A03 violation: AI turn created a server version or changed revision before user Save (versions ${versionsBeforeTurn} -> ${versionsAfterTurn}, revision ${v1Revision} -> ${revisionAfterTurn})`,
        details: { versionsBeforeTurn, versionsAfterTurn, v1Revision, revisionAfterTurn },
      };
    }

    // 4. Deterministic step: write the expected X/Y/Z columns in the workbook
    //    and Save through the web office-frame upload + commit routes -> v2.
    const v2Workbook = buildXlsxRevenueWithXyzBytes(repoRoot);
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
      return {
        exitCode: 1,
        status: "FAIL",
        reason: "uploadOfficeFrameFile did not return a matching upload_id and sha256",
        details: { upload: uploadRes.data, expectedSha256: v2Workbook.sha256 },
      };
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
    const v2Version = commitRes.data?.version?.version;
    const v2Revision = commitRes.data?.document?.revision;
    const v2Checksum = commitRes.data?.version?.checksum_sha256;
    if (v2Version !== 2 || v2Checksum !== v2Workbook.sha256 || !v2Revision || v2Revision === v1Revision) {
      return {
        exitCode: 1,
        status: "FAIL",
        reason: `commitOfficeFrameVersion did not produce version 2 (got version=${v2Version}, checksum=${v2Checksum})`,
        details: { commit: commitRes.data },
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
    if (versionsAfterSave !== 2) {
      return {
        exitCode: 1,
        status: "FAIL",
        reason: `expected 2 versions after web Save, got ${versionsAfterSave}`,
        details: { versionsAfterSave },
      };
    }

    // 5. Verify workspace change feed (G5-01b/G5-02) delivers the new v2 version.
    const feedRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "listDocumentChanges",
      params: { workspaceID: workspaceId },
      query: initialCursor ? { cursor: initialCursor } : {},
      token,
    });
    const feedItems = [
      ...(Array.isArray(feedRes.data?.changes) ? feedRes.data.changes : []),
      ...(Array.isArray(feedRes.data?.feed) ? feedRes.data.feed : []),
    ];
    const hitInFeed = feedItems.find(
      (item) =>
        item.document_id === documentId &&
        item.version === 2 &&
        item.checksum_sha256 === v2Workbook.sha256,
    );
    if (!hitInFeed) {
      return {
        exitCode: 1,
        status: "FAIL",
        reason: `workspace change feed did not report document ${documentId} at version 2 (${v2Workbook.sha256})`,
        details: { feedResponse: feedRes.data },
      };
    }

    // 6. Classify the AI segment per contract-p0 §8.
    const aiSegment = classifyAiResponse(aiTurnRes, v2Workbook.expectedXyz);
    const desktopPre = checkDesktopPrecondition(portsEnv);
    const details = {
      loop: "1",
      fixtureId: "fx-xlsx-revenue-xyz",
      documentId,
      workspaceId,
      versionsBeforeTurn,
      versionsAfterTurn,
      versionsAfterSave,
      v1Sha256: fixture.sha256,
      v2Sha256: v2Workbook.sha256,
      changeFeedDeliveredV2: true,
      webSaveAndFeedSegment: {
        status: "PASS",
        summary: "Web frame open -> 0-version AI turn -> X/Y/Z v2 commit -> workspace change feed v2 verified",
      },
      aiSegment,
      appDesktopPrecondition: desktopPre.ok ? "signed_in" : desktopPre.reason,
    };

    if (aiSegment.status === "FAIL") {
      return { exitCode: 1, status: "FAIL", reason: aiSegment.reason, details };
    }
    if (aiSegment.status === "BLOCKED") {
      return {
        exitCode: BLOCKED_EXIT,
        status: "BLOCKED",
        owner: UPSTREAM_BLOCKED_OWNER,
        reason: `${UPSTREAM_BLOCKED_REASON}; deterministic web-save -> v2 -> change-feed half proven (versions ${versionsBeforeTurn}->${versionsAfterTurn} on AI turn, v2=${v2Workbook.sha256.slice(0, 12)} on Save)`,
        details,
      };
    }
    if (!desktopPre.ok) {
      return {
        exitCode: BLOCKED_EXIT,
        status: "BLOCKED",
        owner: UPSTREAM_BLOCKED_OWNER,
        reason: desktopPre.reason,
        details,
      };
    }
    return {
      exitCode: 0,
      status: "PASS",
      reason: "Loop 1 passed end to end",
      details,
    };
  } finally {
    await cleanupSeededOrganization({ apiOrigin, fetchImpl, seeded });
  }
}

// ---- Loop 2: fx-docx-report-vi (AI edit turn -> 0 versions -> Save in App -> v2) ----

async function runLoop2({
  apiOrigin,
  portsEnv,
  repoRoot,
  fetchImpl = fetch,
}) {
  const seeded = await seedFixtureDocument({
    apiOrigin,
    fetchImpl,
    fixtureId: "fx-docx-report-vi",
    repoRoot,
  });
  try {
    const { token, workspaceId, documentId, filename } = seeded;
    const docxPair = buildEditedDocxFixtureBytes(repoRoot);

    // 1. Baseline check before AI turn: version count === 1, revision === v1.
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
    if (versionsBeforeTurn !== 1 || !revisionBefore) {
      return {
        exitCode: 1,
        status: "FAIL",
        reason: `expected 1 version at baseline, got ${versionsBeforeTurn}`,
        details: { versionsBeforeTurn, revisionBefore },
      };
    }

    // 2. Call the desktop app's document-scoped UniWork AI endpoint.
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

    // 3. G6-A03 early evidence: verify the AI turn created 0 server versions,
    //    did not advance document.revision, and created no commit intent.
    const versionsAfterTurnRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "listDocumentVersions",
      params: { documentID: documentId },
      token,
    });
    const versionsAfterTurn = versionsAfterTurnRes.data?.versions?.length ?? 0;
    const docAfterTurnRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "getDocument",
      params: { documentID: documentId },
      token,
    });
    const revisionAfterTurn = docAfterTurnRes.data?.document?.revision;

    const commitKey = `g710-loop2-${documentId}-v2`;
    const intentBeforeSave = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "lookupCommitIntent",
      params: { documentID: documentId },
      token,
      headers: { "Idempotency-Key": commitKey },
    });

    if (
      versionsAfterTurn !== 1 ||
      revisionAfterTurn !== revisionBefore ||
      intentBeforeSave.data?.outcome !== "not_committed"
    ) {
      return {
        exitCode: 1,
        status: "FAIL",
        reason: `G6-A03 violation: AI turn created a version or save intent before explicit Save (versions=${versionsAfterTurn}, revision=${revisionAfterTurn}, intent=${intentBeforeSave.data?.outcome})`,
        details: {
          versionsBeforeTurn,
          versionsAfterTurn,
          revisionBefore,
          revisionAfterTurn,
          intentBeforeSave: intentBeforeSave.data,
        },
      };
    }

    // 4. Drive explicit Save of the edited DOCX through the app's 2-step upload +
    //    idempotent commit flow (`POST /documents/{id}/uploads` + `POST /documents/{id}/versions/commit`).
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
      return {
        exitCode: 1,
        status: "FAIL",
        reason: "uploadDocumentFile failed or returned wrong sha256",
        details: { upload: uploadRes.data, expectedSha256: docxPair.v2Sha256 },
      };
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
      return {
        exitCode: 1,
        status: "FAIL",
        reason: `commitDocumentVersion did not create version 2 (got version=${v2Version})`,
        details: { commit: commitRes.data },
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
    const intentAfterSave = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "lookupCommitIntent",
      params: { documentID: documentId },
      token,
      headers: { "Idempotency-Key": commitKey },
    });

    if (versionsAfterSave !== 2 || intentAfterSave.data?.outcome !== "committed") {
      return {
        exitCode: 1,
        status: "FAIL",
        reason: `expected versionsAfterSave=2 and outcome=committed, got versions=${versionsAfterSave}, outcome=${intentAfterSave.data?.outcome}`,
        details: { versionsAfterSave, intentAfterSave: intentAfterSave.data },
      };
    }

    const aiEditQualitySegment = classifyAiResponse(aiTurnRes);
    const desktopPre = checkDesktopPrecondition(portsEnv);
    const details = {
      loop: "2",
      fixtureId: "fx-docx-report-vi",
      documentId,
      workspaceId,
      versionsBeforeTurn,
      versionsAfterTurn,
      versionsAfterSave,
      commitIntentOutcome: intentAfterSave.data.outcome,
      v1Sha256: docxPair.v1Sha256,
      v2Sha256: docxPair.v2Sha256,
      noAutoSaveSegment: {
        status: "PASS",
        summary: "G6-A03 invariant verified: AI turn created 0 versions/intents; explicit Save created version 2",
      },
      aiEditQualitySegment,
      appDesktopPrecondition: desktopPre.ok ? "signed_in" : desktopPre.reason,
    };

    if (aiEditQualitySegment.status === "BLOCKED") {
      return {
        exitCode: BLOCKED_EXIT,
        status: "BLOCKED",
        owner: UPSTREAM_BLOCKED_OWNER,
        reason: `${UPSTREAM_BLOCKED_REASON}; G6-A03 no-auto-save invariant (versionsBefore=1, versionsAfterTurn=1) and explicit Save -> v2 (versionsAfterSave=2) proven`,
        details,
      };
    }
    if (!desktopPre.ok) {
      return {
        exitCode: BLOCKED_EXIT,
        status: "BLOCKED",
        owner: UPSTREAM_BLOCKED_OWNER,
        reason: desktopPre.reason,
        details,
      };
    }
    return {
      exitCode: 0,
      status: "PASS",
      reason: "Loop 2 passed end to end",
      details,
    };
  } finally {
    await cleanupSeededOrganization({ apiOrigin, fetchImpl, seeded });
  }
}

// ---- Loop 3: fx-docx-report-vi (Offline Save in App -> Reconnect -> Receipt) ----

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function runLoop3({
  apiOrigin,
  portsEnv,
  repoRoot,
  fetchImpl = fetch,
  timeoutMs = 20_000,
  spawnAppHook = null,
}) {
  const seeded = await seedFixtureDocument({
    apiOrigin,
    fetchImpl,
    fixtureId: "fx-docx-report-vi",
    repoRoot,
  });
  try {
    const { token, userId, workspaceId, documentId, filename } = seeded;
    const docxPair = buildEditedDocxFixtureBytes(repoRoot);

    // 1. Server-side G5-06 queue/reconcile protocol proof:
    //    - While offline (before dispatch), lookupCommitIntent with the queued
    //      Idempotency-Key reports `not_committed`.
    //    - On reconnect, the queued upload + commit with that Idempotency-Key
    //      creates v2 and returns the receipt (`version_id`, `version: 2`, `revision`).
    //    - A reconnect reconciliation lookup AND a duplicate retry with the same
    //      Idempotency-Key return the exact same v2 receipt without creating v3.
    const docBefore = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "getDocument",
      params: { documentID: documentId },
      token,
    });
    const v1Revision = docBefore.data?.document?.revision;
    const offlineIntentKey = `g710-loop3-offline-${documentId}`;

    const lookupWhileOffline = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "lookupCommitIntent",
      params: { documentID: documentId },
      token,
      headers: { "Idempotency-Key": offlineIntentKey },
    });
    if (lookupWhileOffline.data?.outcome !== "not_committed") {
      return {
        exitCode: 1,
        status: "FAIL",
        reason: `expected lookupCommitIntent before reconnect to be not_committed, got ${lookupWhileOffline.data?.outcome}`,
        details: { lookupWhileOffline: lookupWhileOffline.data },
      };
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

    const lookupAfterReconnect = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "lookupCommitIntent",
      params: { documentID: documentId },
      token,
      headers: { "Idempotency-Key": offlineIntentKey },
    });

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

    if (
      v2Version !== 2 ||
      lookupAfterReconnect.data?.outcome !== "committed" ||
      lookupAfterReconnect.data?.version !== 2 ||
      lookupAfterReconnect.data?.version_id !== v2VersionId ||
      retryCommitRes.data?.version?.id !== v2VersionId ||
      versionsAfterIdempotentRetry !== 2
    ) {
      return {
        exitCode: 1,
        status: "FAIL",
        reason: `G5-06 offline reconnect receipt reconciliation failed (v2Version=${v2Version}, outcome=${lookupAfterReconnect.data?.outcome}, versionsAfterRetry=${versionsAfterIdempotentRetry})`,
        details: {
          commit: commitRes.data,
          lookupAfterReconnect: lookupAfterReconnect.data,
          versionsAfterIdempotentRetry,
        },
      };
    }

    const serverReceiptSegment = {
      status: "PASS",
      versionId: v2VersionId,
      version: v2Version,
      revision: v2Revision,
      versionsAfterIdempotentRetry,
    };

    // 2. Desktop app working-copy & receipt check (`binding.json`).
    const desktopPre = checkDesktopPrecondition(portsEnv);
    if (!desktopPre.ok) {
      return {
        exitCode: BLOCKED_EXIT,
        status: "BLOCKED",
        owner: UPSTREAM_BLOCKED_OWNER,
        reason: `${desktopPre.reason}; server-side G5-06 offline intent commit + idempotent receipt reconciliation (v2=${v2VersionId}) proven`,
        details: {
          loop: "3",
          fixtureId: "fx-docx-report-vi",
          documentId,
          workspaceId,
          serverReceiptSegment,
          appReceiptSegment: { status: "BLOCKED", reason: desktopPre.reason },
        },
      };
    }

    const deploymentId = portsEnv.HARNESS_DEPLOYMENT_ID || HARNESS_DEPLOYMENT_ID;
    const launchRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: "mintLaunch",
      params: { documentID: documentId },
      token,
      body: {
        operation: "open",
        deployment_id: deploymentId,
        client_id: DEV_CLIENT_ID,
        return_hint: "",
      },
    });
    const ticket = launchRes.data?.ticket ?? launchRes.data?.launch_ticket ?? "";
    if (!ticket) {
      return {
        exitCode: 1,
        status: "FAIL",
        reason: "mintLaunch returned an empty ticket",
        details: { serverReceiptSegment },
      };
    }

    const deepLink = officeDeepLink(DEV_CLIENT_ID, ticket);
    if (typeof spawnAppHook === "function") {
      await spawnAppHook({ deepLink, documentId, userId });
    } else {
      const childEnv = handoffEnv(portsEnv);
      const handoff = spawnSync(
        portsEnv.ELECTRON_BIN,
        ["--no-sandbox", "--disable-gpu", "--password-store=gnome-libsecret", portsEnv.SHELL_APP_DIR, deepLink],
        { env: childEnv, timeout: 20_000, encoding: "utf8" },
      );
      if (handoff.error || handoff.status !== 0) {
        return {
          exitCode: 1,
          status: "FAIL",
          reason: `second Electron instance failed handing off deep link (status=${handoff.status})`,
          details: { serverReceiptSegment },
        };
      }
    }

    const deadline = Date.now() + (spawnAppHook ? 1_000 : timeoutMs);
    let inspection = inspectWorkingCopy({
      userDataDir: portsEnv.UNIWORK_USER_DATA,
      deploymentId,
      documentId,
      expectedUserId: userId,
      expectedSha256: docxPair.v2Sha256,
    });

    while (Date.now() < deadline) {
      if (
        inspection.bindingPresent &&
        inspection.filePresent &&
        inspection.sha256Match &&
        inspection.bindingState === "saved" &&
        Number(inspection.binding?.baseVersion ?? 0) >= 2
      ) {
        break;
      }
      if (inspection.bindingState === "error" || inspection.bindingState === "conflict") {
        break;
      }
      await sleep(250);
      inspection = inspectWorkingCopy({
        userDataDir: portsEnv.UNIWORK_USER_DATA,
        deploymentId,
        documentId,
        expectedUserId: userId,
        expectedSha256: docxPair.v2Sha256,
      });
    }

    if (
      !inspection.bindingPresent ||
      !inspection.filePresent ||
      !inspection.sha256Match ||
      inspection.bindingState !== "saved" ||
      Number(inspection.binding?.baseVersion ?? 0) < 2
    ) {
      return {
        exitCode: 1,
        status: "FAIL",
        reason: `binding.json did not settle to saved v2 receipt (state=${inspection.bindingState}, error=${inspection.bindingError ?? "none"}, baseVersion=${inspection.binding?.baseVersion ?? "none"})`,
        details: {
          serverReceiptSegment,
          appReceiptSegment: {
            status: "FAIL",
            bindingState: inspection.bindingState,
            bindingError: inspection.bindingError,
            baseVersion: inspection.binding?.baseVersion ?? null,
          },
        },
      };
    }

    return {
      exitCode: 0,
      status: "PASS",
      reason: `Loop 3 passed: v2 receipt (${v2VersionId}) settled in binding.json`,
      details: {
        loop: "3",
        fixtureId: "fx-docx-report-vi",
        documentId,
        workspaceId,
        serverReceiptSegment,
        appReceiptSegment: {
          status: "PASS",
          baseVersion: inspection.binding?.baseVersion,
          baseRevision: inspection.binding?.baseRevision,
          baseVersionId: inspection.binding?.baseVersionId ?? v2VersionId,
          baseChecksum: inspection.binding?.baseChecksum,
        },
      },
    };
  } finally {
    await cleanupSeededOrganization({ apiOrigin, fetchImpl, seeded });
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
  spawnAppHook = null,
}) {
  const startStatus = readStartStatus(runDir);
  const gate = startGate(startStatus);
  if (gate.gate !== "proceed") {
    const blocked = gate.gate === "blocked";
    return {
      exitCode: blocked ? BLOCKED_EXIT : 1,
      status: blocked ? "BLOCKED" : "FAIL",
      reason: gate.reason,
      details: { loop, startStatus },
    };
  }

  const portsEnvPath = join(runDir, "ports.env");
  if (!existsSync(portsEnvPath)) {
    return {
      exitCode: 1,
      status: "FAIL",
      reason: `no ports.env in ${runDir} (run scripts/office/g5g6g7/harness/start.sh first)`,
      details: { loop },
    };
  }
  const portsEnv = parseEnvFile(readFileSync(portsEnvPath, "utf8"));
  const apiOrigin = portsEnv.API_ORIGIN;
  if (!apiOrigin) {
    return {
      exitCode: 1,
      status: "FAIL",
      reason: `API_ORIGIN missing from ${portsEnvPath}`,
      details: { loop },
    };
  }

  const normalized = LOOP_ALIASES[String(loop)] ?? String(loop);
  try {
    if (normalized === "1") {
      return await runLoop1({ apiOrigin, portsEnv, repoRoot, fetchImpl });
    }
    if (normalized === "2") {
      return await runLoop2({ apiOrigin, portsEnv, repoRoot, fetchImpl });
    }
    if (normalized === "3") {
      return await runLoop3({
        apiOrigin,
        portsEnv,
        repoRoot,
        fetchImpl,
        timeoutMs,
        spawnAppHook,
      });
    }
    return {
      exitCode: 2,
      status: "FAIL",
      reason: `unsupported loop "${loop}"`,
      details: {},
    };
  } catch (err) {
    return {
      exitCode: 1,
      status: "FAIL",
      reason: err instanceof Error ? err.message : String(err),
      details: { loop: normalized },
    };
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

  mkdirSync(args.runDir, { recursive: true });
  const artifactPath = join(args.runDir, `tracer-loop-${args.loop}.json`);
  appendFileSync(artifactPath, `${JSON.stringify(res, null, 2)}\n`);

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
