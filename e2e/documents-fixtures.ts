import { expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { registerApiUser } from "./meeting-recording-fixture";

/**
 * The G1-09 acceptance scene built over the HTTP API (plan §4 G1-09): two
 * organizations, three workspaces, a recipient outside the document
 * workspace, an agent, a deactivated member and an account in no
 * organization. e2e/documents-isolation.spec.ts runs the isolation rows on
 * it; the Go twin is server/internal/service/document_fixtures_test.go.
 *
 * Nothing here signs anyone in: tests keep the bearer tokens and either call
 * the API directly or use loginViaUi. No case is admin-only.
 */
interface DocsAccount {
  token: string;
  email: string;
  orgId: string;
  orgSlug: string;
  wsId: string;
  wsSlug: string;
}

interface DocsUser {
  token: string;
  email: string;
}

export interface DocumentMatrix {
  api: string;
  aOwner: DocsAccount;
  aAdmin: DocsUser;
  aMember: DocsUser;
  aOther: DocsUser;
  aOutside: DocsUser;
  aDeact: DocsUser;
  bOwner: DocsAccount;
  bMember: DocsUser;
  publicUser: DocsUser;
  aAgentId: string;
  aWS2Id: string;
}

/** Org and workspace slugs cap at 40 characters of a-z, 0-9 and "-". */
function shortSlug(prefix: string): string {
  const head = prefix.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 22).replace(/-+$/, "");
  return `${head}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/** Registers a verified account that owns one organization and one workspace. */
async function createDocsAccount(page: Page, api: string, tag: string): Promise<DocsAccount> {
  const user = await registerApiUser(page, api, tag);
  const orgSlug = shortSlug(`o-${tag.split("-").slice(-2).join("-")}`);
  const createdOrg = await page.request.post(`${api}/api/v1/orgs`, {
    headers: authHeader(user.token),
    data: { name: `Org ${tag}`, slug: orgSlug },
  });
  expect(createdOrg.ok(), `create org: HTTP ${createdOrg.status()} ${await createdOrg.text()}`).toBeTruthy();
  const orgId = ((await createdOrg.json()) as { organization: { id: string } }).organization.id;

  const wsSlug = shortSlug(`w-${tag.split("-").slice(-2).join("-")}`);
  const wsId = await createWorkspaceInOrg(page, api, user.token, orgId, orgSlug, wsSlug);
  const completed = await page.request.post(`${api}/api/v1/me/onboarding/complete`, {
    headers: authHeader(user.token),
    data: { completion_path: "full", workspace_id: wsId },
  });
  expect(completed.ok(), `complete onboarding: HTTP ${completed.status()} ${await completed.text()}`).toBeTruthy();
  return { token: user.token, email: user.email, orgId, orgSlug, wsId, wsSlug };
}

async function createWorkspaceInOrg(
  page: Page,
  api: string,
  token: string,
  orgId: string,
  name: string,
  slug: string,
): Promise<string> {
  const created = await page.request.post(`${api}/api/v1/orgs/${orgId}/workspaces`, {
    headers: authHeader(token),
    data: { name, slug },
  });
  expect(created.ok(), `create workspace ${slug}: HTTP ${created.status()} ${await created.text()}`).toBeTruthy();
  return ((await created.json()) as { workspace: { id: string } }).workspace.id;
}

/**
 * Invites a registered user into a workspace and accepts as that user.
 * Mirrors meeting-recording-fixture.joinWorkspaceAsMember with a role
 * parameter (that helper hardcodes member); accepting marks the invitee
 * onboarded, so the UI flows can sign them in.
 */
async function inviteAndAccept(
  page: Page,
  api: string,
  hostToken: string,
  wsId: string,
  user: DocsUser,
  role = "member",
): Promise<void> {
  const invited = await page.request.post(`${api}/api/v1/workspaces/${wsId}/invitations`, {
    headers: authHeader(hostToken),
    data: { emails: [user.email], role },
  });
  expect(invited.ok(), `invite ${user.email}: HTTP ${invited.status()} ${await invited.text()}`).toBeTruthy();
  const listed = await page.request.get(`${api}/api/v1/me/invitations`, { headers: authHeader(user.token) });
  expect(listed.ok(), `list invitations: HTTP ${listed.status()} ${await listed.text()}`).toBeTruthy();
  const { invitations } = (await listed.json()) as { invitations: { token: string }[] };
  const token = invitations[0]?.token;
  expect(token, `no invitation for ${user.email}`).toBeTruthy();
  const accepted = await page.request.post(`${api}/api/v1/invitations/${token}/accept`, {
    headers: authHeader(user.token),
  });
  expect(accepted.ok(), `accept invitation: HTTP ${accepted.status()} ${await accepted.text()}`).toBeTruthy();
}

async function createSeatedAgent(page: Page, api: string, owner: DocsAccount, tag: string): Promise<string> {
  const created = await page.request.post(`${api}/api/v1/orgs/${owner.orgSlug}/agents`, {
    headers: authHeader(owner.token),
    data: { name: `Agent ${tag}`, handle: shortSlug("agent") },
  });
  expect(created.ok(), `create agent: HTTP ${created.status()} ${await created.text()}`).toBeTruthy();
  const agentId = ((await created.json()) as { agent: { id: string } }).agent.id;
  const seated = await page.request.post(`${api}/api/v1/workspaces/${owner.wsId}/agents`, {
    headers: authHeader(owner.token),
    data: { agent_id: agentId },
  });
  expect(seated.ok(), `seat agent: HTTP ${seated.status()} ${await seated.text()}`).toBeTruthy();
  return agentId;
}

function e2eDatabaseUrl(): string {
  return (
    process.env.E2E_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgres://uniwork:uniwork@localhost:5432/uniwork?sslmode=disable"
  );
}

/** Fixture-only setup: stamps the F-03 lifecycle column, skipping the command. */
async function deactivateOrgMember(email: string): Promise<void> {
  const c = new Client({ connectionString: e2eDatabaseUrl() });
  await c.connect();
  try {
    const r = await c.query(
      `UPDATE organization_members om SET deactivated_at = now()
         FROM users u WHERE u.id = om.user_id AND lower(u.email) = lower($1)`,
      [email],
    );
    if (r.rowCount !== 1) throw new Error(`deactivateOrgMember: expected 1 membership for ${email}, got ${r.rowCount}`);
  } finally {
    await c.end();
  }
}

/** Builds the whole scene. One call per test file, in `beforeAll`. */
export async function documentMatrix(page: Page, api: string, tag: string): Promise<DocumentMatrix> {
  const aOwner = await createDocsAccount(page, api, `${tag}-a-owner`);
  const aWS2Id = await createWorkspaceInOrg(
    page,
    api,
    aOwner.token,
    aOwner.orgId,
    `A Two ${tag}`,
    shortSlug("w-a-two"),
  );

  const aAdmin = await registerApiUser(page, api, `${tag}-a-admin`);
  await inviteAndAccept(page, api, aOwner.token, aOwner.wsId, aAdmin, "admin");

  const aMember = await registerApiUser(page, api, `${tag}-a-member`);
  await inviteAndAccept(page, api, aOwner.token, aOwner.wsId, aMember);

  const aOther = await registerApiUser(page, api, `${tag}-a-other`);
  await inviteAndAccept(page, api, aOwner.token, aOwner.wsId, aOther);

  const aOutside = await registerApiUser(page, api, `${tag}-a-outside`);
  await inviteAndAccept(page, api, aOwner.token, aWS2Id, aOutside);

  const aDeact = await registerApiUser(page, api, `${tag}-a-deact`);
  await inviteAndAccept(page, api, aOwner.token, aOwner.wsId, aDeact);
  await deactivateOrgMember(aDeact.email);

  const bOwner = await createDocsAccount(page, api, `${tag}-b-owner`);
  const bMember = await registerApiUser(page, api, `${tag}-b-member`);
  await inviteAndAccept(page, api, bOwner.token, bOwner.wsId, bMember);

  const publicUser = await registerApiUser(page, api, `${tag}-public`);
  const aAgentId = await createSeatedAgent(page, api, aOwner, tag);

  return { api, aOwner, aAdmin, aMember, aOther, aOutside, aDeact, bOwner, bMember, publicUser, aAgentId, aWS2Id };
}
