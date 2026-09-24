import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
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

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID-shaped id, so seeded rows look like the ids the server mints. */
export function e2eUlid(): string {
  let time = Date.now();
  const stamp = Array.from({ length: 10 }, () => {
    const char = CROCKFORD[time % 32];
    time = Math.floor(time / 32);
    return char;
  })
    .reverse()
    .join("");
  const random = Array.from({ length: 16 }, () => CROCKFORD[Math.floor(Math.random() * 32)]).join("");
  return `${stamp}${random}`;
}

/** Repo root of the checkout under test (the e2e working directory is <root>/e2e). */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    if (existsSync(join(dir, "server")) && existsSync(join(dir, "packages"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`repo root not found above ${process.cwd()}`);
}

/**
 * The app's local-storage directory. This process does not inherit the server's
 * LOCAL_UPLOAD_DIR (the app reads it from .env.worktree), so a caller can pass
 * E2E_UPLOAD_DIR; otherwise the single server/data/uploads-* directory of the
 * checkout is used, which is what init-worktree-env.sh gives each worktree.
 */
export function localUploadDir(): string {
  const configured = process.env.E2E_UPLOAD_DIR ?? process.env.LOCAL_UPLOAD_DIR;
  const root = repoRoot();
  if (configured) {
    // `make start` runs the server from <root>/server, so a relative
    // LOCAL_UPLOAD_DIR (server/data/...) lands under server/server/data; a
    // binary started from the repo root keeps it under server/data. Prefer the
    // directory that exists, which is the one the app is writing to.
    const candidates = isAbsolute(configured)
      ? [configured]
      : [resolve(join(root, "server"), configured), resolve(root, configured)];
    return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
  }
  // The dev server runs from <root>/server, so its relative LOCAL_UPLOAD_DIR
  // (server/data/...) lands in server/server/data; a binary started from the
  // repo root keeps it in server/data.
  const dataDirs = [join(root, "server", "data"), join(root, "server", "server", "data")];
  const candidates = dataDirs.flatMap((dataDir) =>
    existsSync(dataDir)
      ? readdirSync(dataDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name.startsWith("uploads"))
          .map((entry) => join(dataDir, entry.name))
      : [],
  );
  if (candidates.length !== 1) {
    throw new Error(
      `expected exactly one uploads-* directory for the app under test, found ${candidates.length}: set E2E_UPLOAD_DIR`,
    );
  }
  return candidates[0];
}

/** Writes the object a recording provider would have uploaded for `key`. */
export async function writeLocalObject(key: string, body: Buffer): Promise<void> {
  const target = join(localUploadDir(), key);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body);
}

/**
 * Seeds the COMPLETE recording row a finished LiveKit egress leaves behind, so
 * the playback paths run without an egress provider. Fixture setup only: it
 * skips the recording command and its audit row on purpose.
 */
export async function seedCompletedMeetingRecording(meetingId: string, fileUrl: string): Promise<string> {
  const id = e2eUlid();
  return withClient(async (c) => {
    const result = await c.query<{ id: string }>(
      `INSERT INTO meeting_recordings (id, meeting_id, egress_id, status, file_url, started_by, started_at, ended_at)
       SELECT $1, m.id, $3, 'COMPLETE', $4, m.host_user_id, now() - interval '5 minutes', now() - interval '1 minute'
         FROM meetings m WHERE m.id = $2
       RETURNING id`,
      [id, meetingId, `e2e-egress-${id}`, fileUrl],
    );
    if (result.rowCount !== 1) throw new Error(`seedCompletedMeetingRecording: no meeting ${meetingId}`);
    return result.rows[0].id;
  });
}