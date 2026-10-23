#!/usr/bin/env node
// Seeds a fresh UniWork server for the signed-in device flows that gate a mobile PR (mobile-verify.yml ›
// android-e2e, audit "nightly-never-scheduled": no signed-in flow blocked a merge). Through the public API only, the
// way the web's onboarding does it: three accounts (the test account the app signs in as, a peer, a third member so a
// group can exist: a group takes at least two others), one organization and workspace, a group room named
// "UniChat Maestro" and the peer's DM with the test account. The server must run with APP_ENV=development and
// DEV_VERIFICATION_CODE (the code every email verification accepts there).
//
// It prints the MAESTRO_* settings the flows read (apps/chat-mobile/maestro), the same names the nightly reads from
// the repository's variables and secrets, as KEY=VALUE lines appended to --github-env (the job's $GITHUB_ENV), and
// masks the password in the log (::add-mask::). Tokens never leave the script: the flows that act as the peer sign in
// as it themselves (maestro/scripts/peer-session.js), because an access token lives fifteen minutes and the flows run
// longer than that after the seed.
//
//   node scripts/mobile-e2e-seed.mjs --api http://localhost:8080 --app http://localhost:3000 [--code 123456] \
//     [--github-env "$GITHUB_ENV"]
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** The seeded group's name: the flows look for it, and lib/maestro-flows.test.ts lists it as fixture text. */
export const ROOM_NAME = "UniChat Maestro";

/** The settings a seed hands the flows; the secrets among them are masked in the job's log. */
export const SECRET_KEYS = new Set(["MAESTRO_TEST_PASSWORD", "MAESTRO_CALLER_PASSWORD"]);

/**
 * One JSON call to the API: the parsed body, or an error that names the endpoint and the status (never a token or a
 * password: the request body is not echoed).
 */
export function client(api, fetchImpl = fetch) {
  return async function call(method, path, { token, body } = {}) {
    const response = await fetchImpl(`${api}/api/v1${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  };
}

async function account(call, { email, password, name, code }) {
  const session = await call("POST", "/auth/register", { body: { email, password, display_name: name } });
  const token = session.access_token;
  const id = session.user?.id;
  if (!token || !id) throw new Error(`POST /auth/register for ${name} returned no session`);
  await call("POST", "/me/email/verify", { token, body: { code } });
  return { id, token, email, password };
}

/**
 * Seeds the server and returns the flows' settings. `stamp` makes every run's accounts and slugs new, so a rerun on
 * the same database (a retried job) does not collide with the last one.
 */
export async function seed({ api, app, code = "123456", stamp = Date.now(), fetchImpl = fetch }) {
  const call = client(api, fetchImpl);
  const password = `maestro-${stamp}-pw`;
  const mail = (who) => `maestro-${who}-${stamp}@example.com`;
  const me = await account(call, { email: mail("me"), password, name: "Maestro An", code });
  const peer = await account(call, { email: mail("peer"), password, name: "Maestro Bình", code });
  const third = await account(call, { email: mail("third"), password, name: "Maestro Chi", code });

  const orgSlug = `maestro-${stamp}`;
  const wsSlug = `team-${stamp}`;
  const org = await call("POST", "/orgs", { token: me.token, body: { name: `Maestro ${stamp}`, slug: orgSlug } });
  const orgId = org.organization?.id;
  if (!orgId) throw new Error("POST /orgs returned no organization");
  // {org} is the organization's id on this route (server/internal/handler/organization.go › createOrgWorkspace).
  const created = await call("POST", `/orgs/${orgId}/workspaces`, { token: me.token, body: { name: "Maestro Team", slug: wsSlug } });
  const wsId = created.workspace?.id;
  if (!wsId) throw new Error("POST /orgs/{org}/workspaces returned no workspace");
  await call("POST", "/me/onboarding/complete", { token: me.token, body: { completion_path: "invite_skipped", workspace_id: wsId } });
  await call("POST", `/workspaces/${wsId}/invitations`, { token: me.token, body: { emails: [peer.email, third.email], role: "member" } });

  for (const member of [peer, third]) {
    const { invitations = [] } = await call("GET", "/me/invitations", { token: member.token });
    const invitation = invitations.find((row) => row.workspace?.id === wsId || row.workspaces?.some((w) => w.id === wsId));
    if (!invitation?.token) throw new Error("the invitation did not reach the invited account");
    await call("POST", `/invitations/${invitation.token}/accept`, { token: member.token, body: {} });
    await call("POST", "/me/onboarding/complete", { token: member.token, body: { completion_path: "invite_accept", workspace_id: wsId } });
  }

  const group = await call("POST", `/workspaces/${wsId}/chat/groups`, {
    token: me.token,
    body: { name: ROOM_NAME, member_user_ids: [peer.id, third.id] },
  });
  const roomId = group.room?.id;
  if (!roomId) throw new Error("POST …/chat/groups returned no room");
  const dm = await call("POST", `/workspaces/${wsId}/chat/dm`, { token: peer.token, body: { user_id: me.id } });
  const dmRoomId = dm.room?.id;
  if (!dmRoomId) throw new Error("POST …/chat/dm returned no room");
  // A first message in each, so the inbox lists both rooms with a preview.
  await call("POST", `/workspaces/${wsId}/chat/rooms/${roomId}/messages`, { token: peer.token, body: { body: "Xin chào nhóm", client_msg_id: `seed-g-${stamp}` } });
  await call("POST", `/workspaces/${wsId}/chat/rooms/${dmRoomId}/messages`, { token: peer.token, body: { body: "Chào bạn", client_msg_id: `seed-d-${stamp}` } });

  return {
    MAESTRO_API_URL: api,
    MAESTRO_APP_URL: app,
    MAESTRO_ORG_SLUG: orgSlug,
    MAESTRO_WS_SLUG: wsSlug,
    MAESTRO_ROOM_ID: roomId,
    MAESTRO_TEST_EMAIL: me.email,
    MAESTRO_TEST_PASSWORD: password,
    MAESTRO_CALLER_EMAIL: peer.email,
    MAESTRO_CALLER_PASSWORD: password,
    MAESTRO_CALLER_WS_ID: wsId,
    MAESTRO_DM_ROOM_ID: dmRoomId,
  };
}

/** The $GITHUB_ENV lines for these settings, and the mask commands that must reach the log before them. */
export function githubEnv(settings) {
  const masks = Object.entries(settings)
    .filter(([key]) => SECRET_KEYS.has(key))
    .map(([, value]) => `::add-mask::${value}`);
  const lines = Object.entries(settings).map(([key, value]) => {
    if (/[\r\n]/.test(String(value))) throw new Error(`${key} holds a newline`);
    return `${key}=${value}`;
  });
  return { masks, lines };
}

function arg(argv, name, fallback) {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const api = arg(argv, "api");
  const app = arg(argv, "app");
  if (!api || !app) {
    console.error("usage: mobile-e2e-seed.mjs --api <url> --app <url> [--code 123456] [--github-env <file>]");
    process.exit(2);
  }
  const settings = await seed({ api, app, code: arg(argv, "code", "123456") });
  const { masks, lines } = githubEnv(settings);
  for (const mask of masks) console.log(mask);
  const file = arg(argv, "github-env");
  if (file) fs.appendFileSync(file, `${lines.join("\n")}\n`);
  console.log(`Seeded ${settings.MAESTRO_ORG_SLUG}/${settings.MAESTRO_WS_SLUG}: room ${settings.MAESTRO_ROOM_ID}, DM ${settings.MAESTRO_DM_ROOM_ID}`);
}
