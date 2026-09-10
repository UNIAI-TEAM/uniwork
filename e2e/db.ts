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
