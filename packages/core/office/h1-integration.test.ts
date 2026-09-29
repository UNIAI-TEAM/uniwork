// @vitest-environment node
/**
 * AC-3 of G3-01 (UNI-820): the Office save seam against the REAL root API
 * (H1 = Go server + Postgres + FileService local). On the lane's own database
 * it proves the flow the coordinator depends on: create a file document →
 * stage an upload → commit with an Idempotency-Key → refetch; a retry with the
 * same key replays the stored answer without writing a second version; a commit
 * on a stale base answers 409 document_version_conflict and leaves the document
 * revision alone.
 *
 * Off by default. Set OFFICE_H1_API_URL (e.g. http://localhost:18203) with the
 * server up to run it; without it the suite is skipped, because a skipped H1
 * probe is not evidence (plan §7.1), never a pass. OFFICE_H1_TOKEN can supply
 * an existing session token instead of registering a fresh user (useful when
 * the credential rate limit is warm). The fixture bytes come from the G0
 * manifest files (F-MD-FULL by default).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDocumentFile, getDocument, uploadDocumentFile } from "../api/endpoints/documents";
import { commitDocumentVersion, listDocumentVersions } from "../api/endpoints/documents-versions";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";

const apiUrl = process.env.OFFICE_H1_API_URL?.trim().replace(/\/$/, "");
const suppliedToken = process.env.OFFICE_H1_TOKEN?.trim();
/** The server's DEV_VERIFICATION_CODE: founding an organization needs a
 *  verified email, and local runs verify without reading mail. */
const devCode = process.env.OFFICE_H1_DEV_CODE?.trim() ?? "123456";
const fixtureFile = process.env.OFFICE_H1_FIXTURE_FILE?.trim()
  ?? "docs/office/g0/fixtures/files/text/markdown-kitchen-sink.md";
const fixtureMime = process.env.OFFICE_H1_FIXTURE_MIME?.trim() ?? "text/markdown";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Bootstrap calls outside the core save seam: register + tenant + document. */
async function bootstrap(path: string, token: string | null, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) throw new Error(`bootstrap ${path} -> ${res.status} ${text.slice(0, 240)}`);
  return parsed;
}

function idOf(body: Record<string, unknown>, key: string): string {
  const record = body[key];
  if (!record || typeof record !== "object") throw new Error(`bootstrap answer has no ${key}`);
  const id = (record as Record<string, unknown>).id;
  if (typeof id !== "string") throw new Error(`bootstrap ${key} has no id`);
  return id;
}

describe.skipIf(!apiUrl)("Office save seam against the real H1 API", () => {
  beforeAll(() => {
    if (apiUrl) configureRuntime({ apiUrl });
  });
  afterAll(() => {
    setAccessToken(null);
    resetRuntimeConfig();
  });

  it("uploads, commits with an Idempotency-Key, refetches, replays, and refuses a stale base", async () => {
    if (!apiUrl) return;
    const suffix = stamp();
    let token = suppliedToken;
    if (!token) {
      const registered = await bootstrap("/api/v1/auth/register", null, {
        email: `g3-01-h1-${suffix}@example.test`,
        password: "password123",
        display_name: "G3-01 H1 probe",
      });
      token = registered.access_token as string;
      // Register sends the code; the dev code stands in for the mailed one so
      // the run needs no mailbox (config.DevVerificationCode).
      await bootstrap("/api/v1/me/email/verify", token, { code: devCode });
    }
    expect(typeof token).toBe("string");
    setAccessToken(token);

    const org = await bootstrap("/api/v1/orgs", token, { name: `G3-01 ${suffix}`, slug: `g3-01-${suffix}` });
    const ws = await bootstrap(`/api/v1/orgs/${idOf(org, "organization")}/workspaces`, token, { name: "H1", slug: "h1" });

    const bytes = readFileSync(resolve(repoRoot, fixtureFile));
    const created = await createDocumentFile(ws ? idOf(ws, "workspace") : "", new Blob([bytes], { type: fixtureMime }), {
      title: `g3-01-h1-${suffix}.md`,
    });
    expect(created).not.toBeNull();
    const documentId = created!.id;
    const baseRevision = created!.revision;
    expect(baseRevision).toMatch(/^\d+$/);

    const staged = await uploadDocumentFile(documentId, new Blob([bytes], { type: fixtureMime }));
    expect(staged).not.toBeNull();

    const key = `g3-01-h1-${suffix}`;
    const committed = await commitDocumentVersion(
      documentId,
      { upload_id: staged!.upload_id, base_revision: baseRevision },
      { idempotencyKey: key },
    );
    expect(committed).not.toBeNull();
    const revisionAfterCommit = committed!.document.revision;
    expect(BigInt(revisionAfterCommit)).toBeGreaterThan(BigInt(baseRevision));

    const versionsAfterCommit = await listDocumentVersions(documentId, { limit: 50 });
    const refetched = await getDocument(documentId);
    expect(refetched).not.toBeNull();
    expect(refetched!.revision).toBe(revisionAfterCommit);

    // The same key + upload + base replays the stored answer: same version, no
    // second version row.
    const replayed = await commitDocumentVersion(
      documentId,
      { upload_id: staged!.upload_id, base_revision: baseRevision },
      { idempotencyKey: key },
    );
    expect(replayed).not.toBeNull();
    expect(replayed!.version.id).toBe(committed!.version.id);
    const versionsAfterRetry = await listDocumentVersions(documentId, { limit: 50 });
    expect(versionsAfterRetry.versions.length).toBe(versionsAfterCommit.versions.length);

    // A fresh upload committed on the original (stale) base is refused and
    // leaves the revision where the successful commit put it.
    const stagedAgain = await uploadDocumentFile(documentId, new Blob([bytes], { type: fixtureMime }));
    expect(stagedAgain).not.toBeNull();
    await expect(commitDocumentVersion(
      documentId,
      { upload_id: stagedAgain!.upload_id, base_revision: baseRevision },
      { idempotencyKey: `${key}-stale` },
    )).rejects.toMatchObject({ status: 409, code: "document_version_conflict" });
    const afterStale = await getDocument(documentId);
    expect(afterStale!.revision).toBe(revisionAfterCommit);
    const versionsAfterStale = await listDocumentVersions(documentId, { limit: 50 });
    expect(versionsAfterStale.versions.length).toBe(versionsAfterCommit.versions.length);
  }, 60_000);
});
