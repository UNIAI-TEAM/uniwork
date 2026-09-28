import { Client } from "pg";

/**
 * Global setup: turn the `documents` flag on for the database the suite runs
 * against. The flag defaults off (server/internal/featureflags/keys.go) until
 * the Documents module ships, and the CI e2e job sets no FF_DOCUMENTS, so the
 * documents specs would meet 404s. The suite writes the same global override
 * row a platform admin would, in its own database only, then waits until the
 * public config reports the flag on. The server caches overrides for up to
 * 30 s (featureflags.CacheTTL) and a direct write sends no flag.updated event.
 */
const url =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://uniwork:uniwork@localhost:5432/uniwork?sslmode=disable";
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export default async function globalSetup(): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO feature_flag_overrides (id, flag_key, scope_type, scope_id, enabled, note, created_by, created_by_kind)
       VALUES ('e2e-documents-global', 'documents', 'global', '', true, 'e2e: documents specs', 'e2e', 'system')
       ON CONFLICT (flag_key, scope_type, scope_id) DO UPDATE SET enabled = true`,
    );
  } finally {
    await client.end();
  }

  const deadline = Date.now() + 45_000;
  for (;;) {
    try {
      const res = await fetch(`${api}/api/v1/config`);
      if (res.ok) {
        const body = (await res.json()) as { flags?: Record<string, boolean> };
        if (body.flags?.documents === true) return;
      }
    } catch {
      // The API may still be starting; keep polling until the deadline.
    }
    if (Date.now() > deadline) {
      throw new Error("documents flag is still off after 45 s; is the API up on " + api + "?");
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}
