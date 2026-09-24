import { expect, type Page } from "@playwright/test";
import { VERIFICATION_CODE } from "./auth-nav";

const PASSWORD = "password123";

/**
 * API helpers for the recording specs. They register and onboard an account
 * through the API (email, verify, organization, workspace, onboarding) and keep
 * its bearer token, so a spec never walks the onboarding UI, never borrows the
 * token the page happens to send and never needs an admin account.
 */
export interface RecordingAccount {
  token: string;
  email: string;
  orgSlug: string;
  wsSlug: string;
  wsId: string;
}

export interface ApiUser {
  token: string;
  email: string;
}

export interface SeededMeeting {
  id: string;
  title: string;
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/** Registers a verified account that owns one organization and one workspace. */
export async function createRecordingAccount(page: Page, api: string, tag: string): Promise<RecordingAccount> {
  const stamp = Date.now();
  const email = `${tag}-${stamp}@example.com`;
  const registered = await page.request.post(`${api}/api/v1/auth/register`, {
    data: { email, password: PASSWORD, display_name: tag },
  });
  expect(registered.ok(), `register ${email}: HTTP ${registered.status()} ${await registered.text()}`).toBeTruthy();
  const { access_token: token } = (await registered.json()) as { access_token: string };

  const verified = await page.request.post(`${api}/api/v1/me/email/verify`, {
    headers: authHeader(token),
    data: { code: VERIFICATION_CODE },
  });
  expect(verified.ok(), `verify ${email}: HTTP ${verified.status()} ${await verified.text()}`).toBeTruthy();

  const orgSlug = `rec-org-${stamp}`;
  const createdOrg = await page.request.post(`${api}/api/v1/orgs`, {
    headers: authHeader(token),
    data: { name: `Org ${tag}`, slug: orgSlug },
  });
  expect(createdOrg.ok(), `create org: HTTP ${createdOrg.status()} ${await createdOrg.text()}`).toBeTruthy();
  const orgId = ((await createdOrg.json()) as { organization: { id: string } }).organization.id;

  const wsSlug = `rec-ws-${stamp}`;
  const createdWs = await page.request.post(`${api}/api/v1/orgs/${orgId}/workspaces`, {
    headers: authHeader(token),
    data: { name: `WS ${tag}`, slug: wsSlug },
  });
  expect(createdWs.ok(), `create workspace: HTTP ${createdWs.status()} ${await createdWs.text()}`).toBeTruthy();
  const wsId = ((await createdWs.json()) as { workspace: { id: string } }).workspace.id;

  const completed = await page.request.post(`${api}/api/v1/me/onboarding/complete`, {
    headers: authHeader(token),
    data: { completion_path: "create_workspace", workspace_id: wsId },
  });
  expect(completed.ok(), `complete onboarding: HTTP ${completed.status()} ${await completed.text()}`).toBeTruthy();

  return { token, email, orgSlug, wsSlug, wsId };
}

/** Registers and verifies one more user, for the isolation cases. */
export async function registerApiUser(page: Page, api: string, tag: string): Promise<ApiUser> {
  const email = `${tag}-${Date.now()}@example.com`;
  const created = await page.request.post(`${api}/api/v1/auth/register`, {
    data: { email, password: PASSWORD, display_name: tag },
  });
  expect(created.ok(), `register ${email}: HTTP ${created.status()} ${await created.text()}`).toBeTruthy();
  const { access_token: token } = (await created.json()) as { access_token: string };
  const verified = await page.request.post(`${api}/api/v1/me/email/verify`, {
    headers: authHeader(token),
    data: { code: VERIFICATION_CODE },
  });
  expect(verified.ok(), `verify ${email}: HTTP ${verified.status()} ${await verified.text()}`).toBeTruthy();
  return { token, email };
}

/** Creates an instant meeting (IN_PROGRESS) in the account's workspace. */
export async function createInstantMeeting(
  page: Page,
  api: string,
  token: string,
  wsId: string,
  title: string,
): Promise<SeededMeeting> {
  const res = await page.request.post(`${api}/api/v1/workspaces/${wsId}/meetings/instant`, {
    headers: authHeader(token),
    data: { title },
  });
  expect(res.ok(), `create instant meeting: HTTP ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { meeting: { id: string; title: string } };
  return { id: body.meeting.id, title: body.meeting.title };
}

/** Ends a meeting the way its host does, so the list offers its recordings. */
export async function endMeeting(page: Page, api: string, token: string, meetingId: string): Promise<void> {
  const res = await page.request.post(`${api}/api/v1/meetings/${meetingId}/end`, { headers: authHeader(token) });
  expect(res.ok(), `end meeting: HTTP ${res.status()} ${await res.text()}`).toBeTruthy();
}

/** Invites a registered user to the workspace and accepts as that user. */
export async function joinWorkspaceAsMember(
  page: Page,
  api: string,
  hostToken: string,
  wsId: string,
  user: ApiUser,
): Promise<void> {
  const invited = await page.request.post(`${api}/api/v1/workspaces/${wsId}/invitations`, {
    headers: authHeader(hostToken),
    data: { emails: [user.email], role: "member" },
  });
  expect(invited.ok(), `invite ${user.email}: HTTP ${invited.status()} ${await invited.text()}`).toBeTruthy();
  const listed = await page.request.get(`${api}/api/v1/me/invitations`, { headers: authHeader(user.token) });
  expect(listed.ok(), `list invitations: HTTP ${listed.status()}`).toBeTruthy();
  const { invitations } = (await listed.json()) as { invitations: { token: string }[] };
  expect(invitations.length).toBeGreaterThan(0);
  const accepted = await page.request.post(`${api}/api/v1/invitations/${invitations[0].token}/accept`, {
    headers: authHeader(user.token),
  });
  expect(accepted.ok(), `accept invitation: HTTP ${accepted.status()} ${await accepted.text()}`).toBeTruthy();
}

/** Signs an API-registered account in through the UI so the app has a session. */
export async function loginViaUi(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 });
}

export function recordingContentUrl(api: string, meetingId: string, recordingId: string): string {
  return `${api}/api/v1/meetings/${meetingId}/recordings/${recordingId}/content`;
}