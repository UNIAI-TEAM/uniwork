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
