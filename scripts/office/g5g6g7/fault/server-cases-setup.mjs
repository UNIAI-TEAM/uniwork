/* global process */
// Account and tenant setup for the G7-03a server-layer fault cases (UNI-1380).
// Every expected status below is what the handler writes (file:line of the
// success response in server/internal/handler); paths come from the harness
// call table (../harness/api-contract.mjs) so a route the server does not
// register fails in that table's test, not on a cloud VM.
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { API_PREFIX, apiPath } from "../harness/api-contract.mjs";

/** Success status per setup step: auth.go:73 (sessionResponse) serves register and login. */
export const SETUP_STATUS = {
  register: 200, // auth.go:86 -> sessionResponse -> respondJSON(200) auth.go:73
  login: 200, // auth.go:99 -> sessionResponse auth.go:73
  verifyEmail: 200, // verification.go:22
  completeOnboarding: 200, // onboarding.go:39
  createOrganization: 201, // organization.go:39
  createWorkspace: 201, // organization.go:75
  createInvitation: 200, // workspace.go:153
  acceptInvitation: 200, // workspace.go:214
};

/** The harness default (harness/lib.mjs buildServerEnv `verificationCode`). */
const DEFAULT_VERIFICATION_CODE = "123456";

/**
 * The code the run's server accepts instead of a mailed one. start.sh sources
 * `<runDir>/server.env` (lines `KEY='value'`, lib.mjs writeRunEnv), so that file
 * is the truth; the process env and the harness default come after it.
 */
export function readVerificationCode(runDir, env = process.env) {
  const file = runDir ? join(runDir, "server.env") : "";
  if (file && existsSync(file)) {
    const match = /^DEV_VERIFICATION_CODE='?([^'\r\n]*)'?\s*$/m.exec(readFileSync(file, "utf8"));
    if (match?.[1]) return match[1];
  }
  return env.DEV_VERIFICATION_CODE?.trim() || DEFAULT_VERIFICATION_CODE;
}

function expectStatus(step, label, res, status) {
  if (res.status !== status) throw new Error(`${step} ${label} failed: status ${res.status} (expected ${status})`);
}

export async function registerAndVerifyUser({ http, apiOrigin, tag, verificationCode }) {
  const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  const credential = `FaultPass!${suffix}`;
  const addr = `fault-${tag}-${suffix}@uniwork.test`;
  const reg = await http(apiOrigin, apiPath("register"), {
    method: "POST",
    headers: { "user-agent": `UniWork-Fault-${tag}/1.0` },
    body: { email: addr, password: credential, display_name: `Fault ${tag}` },
  });
  expectStatus("register", tag, reg, SETUP_STATUS.register);
  const token = reg.body?.access_token;
  const userId = reg.body?.user?.id;
  if (!token) throw new Error(`register ${tag} failed: no access_token in the response`);
  const ver = await http(apiOrigin, apiPath("verifyEmail"), { method: "POST", token, body: { code: verificationCode } });
  expectStatus("verify", tag, ver, SETUP_STATUS.verifyEmail);
  const onb = await http(apiOrigin, `${API_PREFIX}/me/onboarding/complete`, { method: "POST", token, body: {} });
  expectStatus("onboarding", tag, onb, SETUP_STATUS.completeOnboarding);
  return { userId, token, addr, credential };
}

export async function seedFaultTenant({ http, apiOrigin, verificationCode }) {
  const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`;
  const primary = await registerAndVerifyUser({ http, apiOrigin, tag: "deviceA", verificationCode });
  const loginB = await http(apiOrigin, apiPath("login"), {
    method: "POST",
    headers: { "user-agent": "UniWork-Fault-deviceB/1.0" },
    body: { email: primary.addr, password: primary.credential },
  });
  expectStatus("login", "deviceB", loginB, SETUP_STATUS.login);
  const orgRes = await http(apiOrigin, apiPath("createOrganization"), {
    method: "POST",
    token: primary.token,
    body: { name: `Fault Org ${suffix}`, slug: `fault-org-${suffix}` },
  });
  expectStatus("create", "org", orgRes, SETUP_STATUS.createOrganization);
  const orgId = orgRes.body?.organization?.id;
  // {org} of this route is the organization ID (api-contract.mjs createWorkspace)
  const wsRes = await http(apiOrigin, apiPath("createWorkspace", { org: orgId }), {
    method: "POST",
    token: primary.token,
    body: { name: `Fault WS ${suffix}`, slug: `fault-ws-${suffix}` },
  });
  expectStatus("create", "workspace", wsRes, SETUP_STATUS.createWorkspace);
  const workspaceId = wsRes.body?.workspace?.id;
  const memberB = await registerAndVerifyUser({ http, apiOrigin, tag: "memberB", verificationCode });

  async function ensureMemberBInWorkspace() {
    const invRes = await http(apiOrigin, `${API_PREFIX}/workspaces/${workspaceId}/invitations`, {
      method: "POST",
      token: primary.token,
      body: { emails: [memberB.addr], role: "member" },
    });
    expectStatus("invite", "memberB", invRes, SETUP_STATUS.createInvitation);
    const myInvs = await http(apiOrigin, `${API_PREFIX}/me/invitations`, { method: "GET", token: memberB.token });
    const pending = (myInvs.body?.invitations ?? []).find((item) => item.workspace?.id === workspaceId);
    if (pending?.token) {
      const acc = await http(apiOrigin, `${API_PREFIX}/invitations/${pending.token}/accept`, {
        method: "POST",
        token: memberB.token,
        body: {},
      });
      expectStatus("accept", "invite", acc, SETUP_STATUS.acceptInvitation);
    }
  }
  await ensureMemberBInWorkspace();

  return {
    orgId,
    workspaceId,
    tokens: { deviceA: primary.token, deviceB: loginB.body?.access_token, owner: primary.token, memberB: memberB.token },
    users: { deviceA: primary.userId, memberB: memberB.userId },
    ensureMemberBInWorkspace,
  };
}
