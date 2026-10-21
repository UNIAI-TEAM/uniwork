import { expect, test, type APIRequestContext, type Page, type Response } from "@playwright/test";
import { e2eApiUrl, e2eBaseUrl } from "./api-url";
import { joinWorkspaceAsMember, registerApiUser, type ApiUser } from "./meeting-recording-fixture";
import { listVersions, openSeededDocument, readPinnedFrame, releaseSeededEditLock, seedDocx, setFlag, type DocsWebPin, type SeededDocx } from "./office-docs-web-fixtures";

/**
 * Comment avatars in the Docs web frame (UNI-1986). The frame's CSP is `img-src 'self' data: blob:`, so a
 * presigned or provider avatar URL can never be an `<img src>` there. The host hands the frame the
 * same-origin route `/api/v1/office-frame/documents/{doc}/avatars/{user}`; the frame fetches it with its
 * frame token and shows a `blob:` URL. A person without a picture stays initials. The frame CSP is not
 * loosened for any of it.
 *
 * A colleague (second user) uploads a picture through `POST /api/v1/me/avatar` and comments on a DOCX; a
 * third user has no picture and comments too. The owner opens the document on `?comment=<id>`, which
 * opens the frame's comment panel. Nothing here depends on the clock: the comments carry server time.
 *
 * Run with OFFICE_DOCS_WEB_E2E=1 (the Docs web frame setup of e2e/office-docs-web.spec.ts).
 */
test.describe.configure({ timeout: 240_000 });
test.skip(process.env.OFFICE_DOCS_WEB_E2E !== "1", "Set OFFICE_DOCS_WEB_E2E=1 to run the Docs web frame contract.");

const baseUrl = e2eBaseUrl;
const pin: DocsWebPin = process.env.OFFICE_DOCS_WEB_E2E === "1" ? readPinnedFrame() : { version: "unpinned", entry: "index.html" };
const FRAME_SELECTOR = 'iframe[src*="/office-frame/docs/"]';
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const AVATAR_ROUTE = /\/api\/v1\/office-frame\/documents\/[0-9A-HJKMNP-TV-Z]{26}\/avatars\/[0-9A-HJKMNP-TV-Z]{26}$/;

const PHOTO_NAME = "ann-with-photo";
const PLAIN_NAME = "bao-no-photo";

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

/** Saves a PNG as the user's picture; the answer must show the server kept one. */
async function uploadAvatar(request: APIRequestContext, user: ApiUser): Promise<void> {
  const response = await request.post(`${e2eApiUrl}/api/v1/me/avatar`, {
    headers: { authorization: `Bearer ${user.token}` },
    multipart: { file: { name: "me.png", mimeType: "image/png", buffer: PNG_1X1 } },
  });
  expect(response.ok(), `upload avatar: HTTP ${response.status()} ${await response.text()}`).toBeTruthy();
  const { user: saved } = (await response.json()) as { user: { avatar_url?: string } };
  expect(saved.avatar_url, "the upload answer carries the picture").toBeTruthy();
}

/**
 * A file document is private to its creator at create (createHomeRow: no parent, no visibility -> restricted), so a
 * colleague who joined the workspace gets 404 on it. A workspace share at comment level is what the product gives them.
 */
async function shareWithWorkspace(request: APIRequestContext, doc: SeededDocx): Promise<void> {
  const response = await request.post(`${e2eApiUrl}/api/v1/documents/${doc.documentId}/shares`, {
    headers: bearer(doc.account.token),
    data: { principal_type: "workspace", principal_id: doc.account.wsId, level: "comment" },
  });
  expect(response.status(), `share with the workspace: HTTP ${response.status()} ${await response.text()}`).toBe(201);
}

/** One anchored docx comment (the Docs panel lists kind=comment roots) by `user`; returns its id. */
async function comment(request: APIRequestContext, user: ApiUser, documentId: string, baseVersionId: string, body: string): Promise<string> {
  const response = await request.post(`${e2eApiUrl}/api/v1/documents/${documentId}/comments`, {
    headers: { ...bearer(user.token), "Idempotency-Key": `avatars-${body}-${Date.now().toString(36)}` },
    data: {
      body,
      kind: "comment",
      base_version_id: baseVersionId,
      anchor: { format: "docx", v: 1, path: [1], start: 0, end: 3, quote: "第一段", prefix: "", suffix: "。" },
    },
  });
  expect(response.status(), `comment as ${user.email}: ${await response.text()}`).toBe(201);
  return ((await response.json()) as { comment: { id: string } }).comment.id;
}

test.describe("frame comment avatars", () => {
  let seeded: SeededDocx;
  let photo: ApiUser;
  let plain: ApiUser;
  let photoCommentId = "";

  test.beforeAll(async ({ browser, request }) => {
    test.skip(!(await request.get(`${baseUrl}/office-frame/docs/${pin.version}/manifest.json`).then((r) => r.ok(), () => false)), "the pinned Docs bundle is not installed in this web build");
    const context = await browser.newContext({ baseURL: baseUrl });
    try {
      const page = await context.newPage();
      seeded = await seedDocx(page, baseUrl, `docs-avatars-${Date.now().toString(36)}`);
      photo = await registerApiUser(page, e2eApiUrl, PHOTO_NAME);
      plain = await registerApiUser(page, e2eApiUrl, PLAIN_NAME);
      await joinWorkspaceAsMember(page, e2eApiUrl, seeded.account.token, seeded.account.wsId, photo);
      await joinWorkspaceAsMember(page, e2eApiUrl, seeded.account.token, seeded.account.wsId, plain);
    } finally {
      await context.close();
    }
    await setFlag("office_engine", seeded.organizationId, true);
    await shareWithWorkspace(request, seeded);
    await uploadAvatar(request, photo);
    // The anchors are written against the newest version, as an editor that has it open would.
    const versions = await listVersions(request, seeded.account.token, seeded.documentId);
    const head = versions.reduce((a, b) => (b.version > a.version ? b : a));
    photoCommentId = await comment(request, photo, seeded.documentId, head.id, "A note from a colleague with a picture");
    await comment(request, plain, seeded.documentId, head.id, "A note from a colleague without one");
  });

  test.afterEach(async ({ request }) => {
    await releaseSeededEditLock(request, seeded);
  });

  test("a colleague's picture is a same-origin blob in the comment panel, under the unchanged frame CSP", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(`console: ${m.text()}`); });
    page.on("pageerror", (e) => violations.push(`pageerror: ${e.message}`));
    // Every frame (the iframe too) reports what the browser blocks.
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    const avatarResponses: Response[] = [];
    let frameDocument: Response | undefined;
    page.on("response", (r) => {
      const { pathname } = new URL(r.url());
      if (AVATAR_ROUTE.test(pathname)) avatarResponses.push(r);
      if (pathname === `/office-frame/docs/${pin.version}/${pin.entry}` || pathname === `/office-frame/docs/${pin.version}/`) frameDocument ??= r;
    });

    await signInAs(page, seeded.account.email);
    await openSeededDocument(page, seeded, `?comment=${photoCommentId}`);

    const frame = page.frameLocator(FRAME_SELECTOR);
    await expect(page.locator(FRAME_SELECTOR)).toBeVisible({ timeout: 60_000 });
    const panel = frame.locator(".docs-server-comments");
    await expect(panel).toBeVisible({ timeout: 60_000 });

    // The picture: a blob the frame made from the route, never a storage or provider URL.
    const photoHead = panel.locator(".collab-au", { hasText: PHOTO_NAME }).locator('xpath=preceding-sibling::span[contains(@class,"collab-av")][1]');
    await expect(photoHead.locator('img[src^="blob:"]')).toBeVisible({ timeout: 30_000 });

    // The person without a picture stays initials: text, no image.
    const plainHead = panel.locator(".collab-au", { hasText: PLAIN_NAME }).locator('xpath=preceding-sibling::span[contains(@class,"collab-av")][1]');
    await expect(plainHead).toBeVisible();
    await expect(plainHead.locator("img")).toHaveCount(0);
    await expect(plainHead).toHaveText(/\S/);
    expect(await panel.locator("img:not([src^='blob:'])").count(), "no avatar image points anywhere but a blob").toBe(0);

    await page.screenshot({ path: test.info().outputPath("avatars-in-comment-panel.png") });

    // The route: one avatar fetched (the colleague with a picture; the other has no route URL), served inert.
    const routes = new Set(avatarResponses.map((r) => new URL(r.url()).pathname));
    expect(routes.size, `avatar routes fetched: ${[...routes].join(", ")}`).toBe(1);
    // The frame may retry once after a 401 (token refresh): accept that, but need a 200 and nothing else.
    const statuses = avatarResponses.map((r) => r.status());
    expect(statuses.filter((code) => code !== 200 && code !== 401), `avatar route statuses: ${statuses.join(", ")}`).toEqual([]);
    const served = avatarResponses.filter((r) => r.status() === 200);
    expect(served.length, `avatar route statuses: ${statuses.join(", ")}`).toBeGreaterThanOrEqual(1);
    for (const r of served) {
      const headers = r.headers();
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
      expect(headers["content-type"]).toBe("image/png");
    }

    // The frame document still carries the locked-down policy, img-src untouched.
    expect(frameDocument, "the frame document response was seen").toBeTruthy();
    const csp = frameDocument!.headers()["content-security-policy"];
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).not.toMatch(/https:/);

    // No violation anywhere, the iframe included.
    for (const f of page.frames()) {
      const seen = await f.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
      expect(seen, `securitypolicyviolation in ${f.url()}`).toEqual([]);
    }
    expect(violations).toEqual([]);
  });
});
