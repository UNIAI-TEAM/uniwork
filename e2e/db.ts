import { Client } from "pg";

/**
 * Đọc mail đã ghi vào outbox. Server local ghi mọi mail vào bảng `emails`
 * (SMTP_HOST trống chỉ in ra log), nên e2e lấy link reset từ đây thay vì
 * một token bypass — bypass cho reset là lỗ hổng không đáng có.
 */
const url =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://uniwork:uniwork@localhost:5432/uniwork?sslmode=disable";

export async function latestEmailText(to: string, kind: string): Promise<string> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    for (let i = 0; i < 20; i++) {
      const r = await c.query<{ text: string }>(
        "SELECT text FROM emails WHERE to_email = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1",
        [to, kind],
      );
      if (r.rows[0]) return r.rows[0].text;
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error(`no ${kind} email for ${to}`);
  } finally {
    await c.end();
  }
}

/**
 * Platform roles refuse /admin without MFA (F-01). E2E grants the role via
 * uniwork-admin then stamps mfa_enabled_at so the console gate opens — no
 * TOTP enrollment UI in these fixtures; the middleware only checks the stamp.
 */
export async function enableMfaForE2E(email: string): Promise<void> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const r = await c.query(
      "UPDATE users SET mfa_enabled_at = COALESCE(mfa_enabled_at, now()), updated_at = now() WHERE lower(email) = lower($1)",
      [email],
    );
    if (r.rowCount !== 1) {
      throw new Error(`enableMfaForE2E: expected 1 user for ${email}, got ${r.rowCount}`);
    }
  } finally {
    await c.end();
  }
}

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/**
 * Turns a flag on or off for everyone, tagged `e2e` so cleanup removes only
 * what a spec wrote. The server caches overrides for up to 30 s, so a spec
 * waits for the effect rather than assuming it.
 */
export async function setE2EFlagOverride(flag: string, enabled: boolean): Promise<void> {
  await withClient(async (c) => {
    await c.query("DELETE FROM feature_flag_overrides WHERE flag_key = $1 AND scope_type = 'global' AND note = 'e2e'", [flag]);
    await c.query(
      `INSERT INTO feature_flag_overrides (id, flag_key, scope_type, scope_id, enabled, note, created_by)
       VALUES ($1, $2, 'global', '', $3, 'e2e', 'e2e') ON CONFLICT DO NOTHING`,
      [`e2e-${flag}-${Date.now()}`, flag, enabled],
    );
  });
}

export async function clearE2EFlagOverride(flag: string): Promise<void> {
  await withClient((c) =>
    c.query("DELETE FROM feature_flag_overrides WHERE flag_key = $1 AND scope_type = 'global' AND note = 'e2e'", [flag]),
  );
}

/**
 * Hands every task of a workspace to the given person, due today in their own
 * time zone, and returns the titles. Fixture setup only: it skips the task
 * command and its audit row on purpose.
 */
export async function assignWorkspaceTasksDueToday(email: string, orgSlug: string, wsSlug: string): Promise<string[]> {
  return withClient(async (c) => {
    const r = await c.query<{ title: string }>(
      `UPDATE tasks t
         SET assignee_id = u.id, assignee_kind = 'human', due_date = (now() AT TIME ZONE u.timezone)::date
        FROM users u, workspaces w, organizations o
       WHERE lower(u.email) = lower($1) AND o.slug = $2 AND w.organization_id = o.id AND w.slug = $3 AND t.workspace_id = w.id
       RETURNING t.title`,
      [email, orgSlug, wsSlug],
    );
    return r.rows.map((row) => row.title);
  });
}

/**
 * Moves an organization's finished audit exports `hours` into the past, so a
 * spec can watch the 24h download window lapse instead of waiting a day. The
 * app reads `completed_at`, so this is the same state the clock would produce.
 * Returns how many jobs moved.
 */
export async function backdateAuditExports(orgSlug: string, hours: number): Promise<number> {
  return withClient(async (c) => {
    const r = await c.query(
      `UPDATE audit_exports ae
          SET completed_at = ae.completed_at - make_interval(hours => $2::int),
              expires_at = ae.expires_at - make_interval(hours => $2::int)
         FROM organizations o
        WHERE o.slug = $1 AND ae.organization_id = o.id AND ae.completed_at IS NOT NULL`,
      [orgSlug, hours],
    );
    return r.rowCount ?? 0;
  });
}