import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import JSZip from "jszip";
import { Client } from "pg";
import { e2eApiUrl } from "./api-url";
import { createRecordingAccount, type RecordingAccount } from "./meeting-recording-fixture";

/**
 * Helpers for the Docs-in-web-frame flow (UNI-1013): seed an account with one
 * DOCX through the API, switch the `office_docs_web` flag per organization, and
 * read the Documents version history back so the spec asserts what the server
 * stored, not what the page shows.
 */
const repoRoot = basename(process.cwd()).toLowerCase() === "e2e" ? resolve(process.cwd(), "..") : process.cwd();
const DOCX_FIXTURE = resolve(repoRoot, "docs/office/g0/fixtures/files/docs/docx-simple.docx");
const PIN_FILE = resolve(repoRoot, "apps/web/platform/office-frame/docs.pin.json");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface DocsWebPin {
  version: string;
  entry: string;
}

export function readPinnedFrame(): DocsWebPin {
  return JSON.parse(readFileSync(PIN_FILE, "utf8")) as DocsWebPin;
}

export interface SeededDocx {
  account: RecordingAccount;
  documentId: string;
  organizationId: string;
  documentUrl: string;
}

export async function seedDocx(page: Page, baseUrl: string, tag: string): Promise<SeededDocx> {
  return seedDocument(page, baseUrl, tag, { name: "docs-web.docx", mimeType: DOCX_MIME, buffer: readFileSync(DOCX_FIXTURE) });
}

/** A fresh account with one file document of any format (the module frame specs, UNI-1014). */
export async function seedDocument(page: Page, baseUrl: string, tag: string, file: { name: string; mimeType: string; buffer: Buffer }): Promise<SeededDocx> {
  const account = await createRecordingAccount(page, e2eApiUrl, tag);
  const response = await page.request.post(`${e2eApiUrl}/api/v1/workspaces/${account.wsId}/documents/files`, {
    headers: { authorization: `Bearer ${account.token}`, "Idempotency-Key": `${tag}-${Date.now().toString(36)}` },
    multipart: { file },
  });
  expect(response.ok(), `seed ${file.name}: HTTP ${response.status()} ${await response.text()}`).toBeTruthy();
  const { document } = (await response.json()) as { document: { id: string; organization_id: string } };
  return {
    account,
    documentId: document.id,
    organizationId: document.organization_id,
    documentUrl: `${baseUrl}/${account.orgSlug}/${account.wsSlug}/documents/${document.id}`,
  };
}

/**
 * Writes the override a platform admin would (organization scope by default,
 * the way a staged rollout does), then waits until
 * `GET /config?organization_id=` reports it (the server caches overrides for
 * featureflags.CacheTTL and a direct write sends no invalidation).
 */
export async function setFlag(flag: string, organizationId: string, enabled: boolean, scope: "global" | "organization" = "organization"): Promise<void> {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://uniwork:uniwork@localhost:5432/uniwork?sslmode=disable";
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO feature_flag_overrides (id, flag_key, scope_type, scope_id, enabled, note, created_by, created_by_kind)
       VALUES ($1, $2, $3, $4, $5, 'e2e: docs web frame', 'e2e', 'system')
       ON CONFLICT (flag_key, scope_type, scope_id) DO UPDATE SET enabled = $5`,
      [`e2e-${flag}-${scope === "global" ? "global" : organizationId}`, flag, scope, scope === "global" ? "" : organizationId, enabled],
    );
  } finally {
    await client.end();
  }
  await expect.poll(async () => {
    const response = await fetch(`${e2eApiUrl}/api/v1/config?organization_id=${encodeURIComponent(organizationId)}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { flags?: Record<string, boolean> };
    return body.flags?.[flag] ?? null;
  }, { timeout: 45_000, intervals: [1_000], message: `${flag}=${enabled} never reached /config` }).toBe(enabled);
}

export interface VersionRow {
  version: number;
  reason: string;
  size_bytes: number;
  created_by_kind: string;
}

export async function listVersions(request: APIRequestContext, token: string, documentId: string): Promise<VersionRow[]> {
  const response = await request.get(`${e2eApiUrl}/api/v1/documents/${documentId}/versions?limit=50`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.ok(), `list versions: HTTP ${response.status()} ${await response.text()}`).toBeTruthy();
  return ((await response.json()) as { versions: VersionRow[] }).versions;
}

/** The text of word/document.xml in version `version` of the document, as stored. */
export async function versionBodyXml(request: APIRequestContext, token: string, documentId: string, version: number): Promise<string> {
  const response = await request.get(`${e2eApiUrl}/api/v1/documents/${documentId}/download?version=${version}`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.ok(), `download v${version}: HTTP ${response.status()}`).toBeTruthy();
  const zip = await JSZip.loadAsync(await response.body());
  const xml = await zip.file("word/document.xml")?.async("string");
  expect(xml, `v${version} is not a docx (no word/document.xml)`).toBeTruthy();
  return xml ?? "";
}

/** Entry names of the docx stored as `version` of the document. */
export async function versionEntries(request: APIRequestContext, token: string, documentId: string, version: number): Promise<string[]> {
  const response = await request.get(`${e2eApiUrl}/api/v1/documents/${documentId}/download?version=${version}`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.ok(), `download v${version}: HTTP ${response.status()}`).toBeTruthy();
  return Object.keys((await JSZip.loadAsync(await response.body())).files);
}

const heldEditLocks = new Map<string, string>();

/**
 * Opens `seeded.documentUrl`, captures the page's `POST /api/v1/documents/{id}/edit-lock`
 * `lock_id` answer (UNI-1645), and records it so `releaseSeededEditLock` (and
 * `seededEditLockId` for `commitElsewhere`) can use it.
 */
export async function openSeededDocument(page: Page, seeded: SeededDocx): Promise<string> {
  const expectedPath = `/api/v1/documents/${seeded.documentId}/edit-lock`;
  const acquired = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === expectedPath,
  );
  await page.goto(seeded.documentUrl);
  const response = await acquired;
  expect(response.ok(), `acquire edit lock: HTTP ${response.status()} ${await response.text()}`).toBeTruthy();
  const { lock_id } = (await response.json()) as { lock_id: string };
  expect(lock_id, "edit-lock response missing lock_id").toBeTruthy();
  heldEditLocks.set(seeded.documentId, lock_id);
  return lock_id;
}

/** The edit-lock tenure id recorded when `seeded` was opened in the current test. */
export function seededEditLockId(seeded: SeededDocx): string | undefined {
  return heldEditLocks.get(seeded.documentId);
}

/**
 * Releases the edit lock recorded for `seeded` via `DELETE /api/v1/documents/{id}/edit-lock/{lockId}`
 * (idempotent 204), so the next test reusing the seeded document can acquire its own tenure.
 */
export async function releaseSeededEditLock(request: APIRequestContext, seeded: SeededDocx | undefined): Promise<void> {
  if (!seeded) return;
  const lockId = heldEditLocks.get(seeded.documentId);
  if (!lockId) return;
  heldEditLocks.delete(seeded.documentId);
  const response = await request.delete(
    `${e2eApiUrl}/api/v1/documents/${encodeURIComponent(seeded.documentId)}/edit-lock/${encodeURIComponent(lockId)}`,
    { headers: { authorization: `Bearer ${seeded.account.token}` } },
  );
  expect(response.ok(), `release edit lock: HTTP ${response.status()} ${await response.text()}`).toBeTruthy();
}

