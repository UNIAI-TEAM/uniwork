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
  const account = await createRecordingAccount(page, e2eApiUrl, tag);
  const response = await page.request.post(`${e2eApiUrl}/api/v1/workspaces/${account.wsId}/documents/files`, {
    headers: { authorization: `Bearer ${account.token}`, "Idempotency-Key": `${tag}-${Date.now().toString(36)}` },
    multipart: { file: { name: "docs-web.docx", mimeType: DOCX_MIME, buffer: readFileSync(DOCX_FIXTURE) } },
  });
  expect(response.ok(), `seed docx: HTTP ${response.status()} ${await response.text()}`).toBeTruthy();
  const { document } = (await response.json()) as { document: { id: string; organization_id: string } };
  return {
    account,
    documentId: document.id,
    organizationId: document.organization_id,
    documentUrl: `${baseUrl}/${account.orgSlug}/${account.wsSlug}/documents/${document.id}`,
  };
}

/**
 * Writes the organization override a platform admin would, then waits until
 * `GET /config?organization_id=` reports it (the server caches overrides for
 * featureflags.CacheTTL and a direct write sends no invalidation).
 */
export async function setOrgFlag(flag: string, organizationId: string, enabled: boolean): Promise<void> {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://uniwork:uniwork@localhost:5432/uniwork?sslmode=disable";
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO feature_flag_overrides (id, flag_key, scope_type, scope_id, enabled, note, created_by, created_by_kind)
       VALUES ($1, $2, 'organization', $3, $4, 'e2e: docs web frame', 'e2e', 'system')
       ON CONFLICT (flag_key, scope_type, scope_id) DO UPDATE SET enabled = $4`,
      [`e2e-${flag}-${organizationId}`, flag, organizationId, enabled],
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
