import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  api,
  authHeaders,
  buildShareScene,
  docPath,
  grantAccess,
  levelOf,
  openSession,
  openShareDialog,
  ownerDoc,
  signInOwner,
  userItem,
  type ShareScene,
} from "./documents-share-fixtures";

/**
 * DOC-07 (UNI-1631, W-DOC07 swap): requesting access to a document on the real
 * stack, no mocks. A member with no access opens the link, sees the locked
 * card, asks for a level with a message and reads "Đã gửi yêu cầu"; a second
 * send answers already-pending (409); the owner sees "Yêu cầu truy cập (1)" in
 * the Share dialog and approves at a lower level, after which the member reads
 * the page; a second request that the owner declines puts the member in the
 * one-hour cooldown (429 access_request_cooldown). Setup goes through the API
 * (the scene, the document, the revoke between the two rounds); the flow runs
 * through the UI. Spec: docs/superpowers/specs/2026-10-15-documents-access-addendum.md
 * §3, §4.3, §4.4, rows DOC7-W01..W03.
 *
 * Needs the runtime of documents-share.spec.ts (FF_DOCUMENTS on, migrations of
 * this worktree applied, Team plan seeded by the fixture scene).
 */
test.describe.configure({ timeout: 360_000 });

const tag = `ar1631-${Date.now().toString(36)}`;
const MESSAGE = "Mình cần xem để chuẩn bị họp thứ Hai";

let s: ShareScene;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  const page = await browser.newPage();
  try {
    s = await buildShareScene(page, tag, 0);
  } finally {
    await page.close();
  }
});

function sendButton(page: Page): Locator {
  return page.getByRole("button", { name: "Gửi yêu cầu", exact: true });
}

/** The request row of the Share dialog that belongs to the member. */
function memberRow(dialog: Locator): Locator {
  return dialog.getByRole("listitem").filter({ hasText: s.member.name });
}

test("a member asks for access, the owner approves lower, a second request is declined into the cooldown", async ({
  page,
  browser,
  request,
}) => {
  const doc = await ownerDoc(request, s, "DOC7");
  const url = docPath(s.m.aOwner, doc.id);

  // Round one, the member: the link opens the locked card, not the document.
  const { context: memberContext, page: member } = await openSession(browser, s.member.email);
  try {
    await member.goto(url);
    await expect(member.getByRole("heading", { name: "Bạn chưa mở được tài liệu này" })).toBeVisible({ timeout: 60_000 });
    expect(await levelOf(request, s.member.token, doc.id)).toBe("");

    await member.getByRole("radio", { name: "Chỉnh sửa" }).click();
    await member.getByRole("textbox", { name: /Lời nhắn/ }).fill(MESSAGE);
    await sendButton(member).click();
    await expect(member.getByRole("status").filter({ hasText: "Đã gửi yêu cầu" })).toBeVisible({ timeout: 30_000 });
    await expect(sendButton(member)).toHaveCount(0);

    // A second send is not a second row: the server answers 409 access_request_pending
    // and the card says the first one is still waiting.
    const again = await request.post(`${api}/api/v1/documents/${doc.id}/access-requests`, {
      headers: authHeaders(s.member.token),
      data: { requested_level: "edit" },
    });
    expect(again.status(), await again.text()).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("access_request_pending");
    await member.reload();
    await expect(sendButton(member)).toBeVisible({ timeout: 60_000 });
    await sendButton(member).click();
    await expect(member.getByRole("status").filter({ hasText: "đang chờ người quản lý trả lời" })).toBeVisible({
      timeout: 30_000,
    });

    // The owner: the Share dialog counts the request and shows who, what level and why.
    await signInOwner(page, s);
    const dialog = await openShareDialog(page, s.m.aOwner, doc.id);
    await expect(dialog.getByRole("heading", { name: "Yêu cầu truy cập (1)" })).toBeVisible({ timeout: 30_000 });
    const row = memberRow(dialog);
    await expect(row).toBeVisible();
    await expect(row.getByText(MESSAGE)).toBeVisible();
    await expect(row.getByText("Chỉnh sửa").first()).toBeVisible();

    // Approve at View, lower than the Edit that was asked for.
    await row.getByRole("combobox", { name: `Mức quyền của ${s.member.name}` }).click();
    await page.getByRole("listbox").filter({ visible: true }).getByRole("option", { name: "Chỉ xem" }).click();
    await row.getByRole("button", { name: "Duyệt", exact: true }).click();
    await expect(dialog.getByText(`Đã cấp quyền Chỉ xem cho ${s.member.name}`)).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByRole("heading", { name: "Yêu cầu truy cập (0)" })).toBeVisible({ timeout: 30_000 });
    expect(await levelOf(request, s.member.token, doc.id)).toBe("view");

    // The member reads the document (a reload is fine).
    await member.reload();
    await expect(member.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press("Escape");

    // Round two: the owner takes the access back, the member asks again, the owner declines.
    await grantAccess(request, s.owner.token, doc.id, [userItem(s.member, null)]);
    expect(await levelOf(request, s.member.token, doc.id)).toBe("");
    await member.reload();
    await expect(member.getByRole("heading", { name: "Bạn chưa mở được tài liệu này" })).toBeVisible({ timeout: 60_000 });
    await sendButton(member).click();
    await expect(member.getByRole("status").filter({ hasText: "Đã gửi yêu cầu" })).toBeVisible({ timeout: 30_000 });

    const dialogAgain = await openShareDialog(page, s.m.aOwner, doc.id);
    await expect(dialogAgain.getByRole("heading", { name: "Yêu cầu truy cập (1)" })).toBeVisible({ timeout: 30_000 });
    await memberRow(dialogAgain).getByRole("button", { name: "Từ chối", exact: true }).click();
    await expect(dialogAgain.getByText(`Đã từ chối yêu cầu của ${s.member.name}`)).toBeVisible({ timeout: 30_000 });
    expect(await levelOf(request, s.member.token, doc.id)).toBe("");

    // The member's open card resets live: the decline clears "sent" without a reload.
    await expect(sendButton(member)).toBeVisible({ timeout: 30_000 });

    // The member is now inside the one-hour cooldown: the card says when to ask again.
    await member.reload();
    await expect(sendButton(member)).toBeVisible({ timeout: 60_000 });
    await sendButton(member).click();
    await expect(member.getByText(/Xin lại được sau \d+ phút/)).toBeVisible({ timeout: 30_000 });
    const cooling = await request.post(`${api}/api/v1/documents/${doc.id}/access-requests`, {
      headers: authHeaders(s.member.token),
      data: {},
    });
    expect(cooling.status(), await cooling.text()).toBe(429);
    const body = (await cooling.json()) as { error: { code: string; fields?: { retry_after_seconds?: number } } };
    expect(body.error.code).toBe("access_request_cooldown");
    expect(body.error.fields?.retry_after_seconds).toBeGreaterThan(0);
    expect(Number(cooling.headers()["retry-after"])).toBe(body.error.fields?.retry_after_seconds);
  } finally {
    await memberContext.close();
  }
});
