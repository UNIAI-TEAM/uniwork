import { expect, test } from "@playwright/test";
import { VERIFICATION_CODE, verifyEmail } from "./auth-nav";

// The golden path for F-03: an organization stops being a shell around
// workspaces. The owner gives a colleague a department and a job title, the
// colleague finds them in the directory by typing without diacritics, and the
// owner then switches them off — at which point the whole organization closes
// to that person rather than silently letting them back in through a workspace
// URL.
//
// Requires `make dev`.
const stamp = Date.now();
const orgSlug = `danh-ba-${stamp}`;
const ownerEmail = `people-owner-${stamp}@example.com`;
const memberEmail = `people-member-${stamp}@example.com`;

type Page = import("@playwright/test").Page;

async function fillRegistration(page: Page, name: string, email: string) {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await expect(page).toHaveURL(/\/verify$/, { timeout: 15_000 });
}

/** A brand-new account with no invitation waiting: verification lands on /onboarding. */
async function registerFounder(page: Page, name: string, email: string) {
  await fillRegistration(page, name, email);
  await verifyEmail(page);
}

/**
 * An account that was invited before it existed. Verification sends it to the
 * pending-invitation screen rather than to onboarding, so this cannot reuse
 * verifyEmail, which asserts the founder's destination.
 */
async function registerInvitee(page: Page, name: string, email: string) {
  await fillRegistration(page, name, email);
  await page.getByLabel("Mã xác thực").fill(VERIFICATION_CODE);
  await page.waitForURL(/\/(invitations|onboarding)$/, { timeout: 15_000 });
}

test("directory, department, accent-insensitive search, then deactivation", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await registerFounder(owner, "Đỗ Thị Hà", ownerEmail);

  await expect(owner).toHaveURL(/\/onboarding$/);
  await owner.getByRole("button", { name: /Bắt đầu/ }).click();
  await owner.getByRole("radio", { name: "Quản lý" }).click();
  await owner.getByRole("checkbox", { name: "Họp trực tuyến" }).click();
  await owner.getByRole("button", { name: "Tiếp tục" }).click();
  await owner.getByLabel("Tên tổ chức").fill(`Danh bạ ${stamp}`);
  await owner.getByRole("button", { name: `Tạo Danh bạ ${stamp}` }).click();
  await owner.getByLabel("Tên workspace").fill("Đội Danh Bạ");
  await owner.getByRole("button", { name: "Tạo Đội Danh Bạ" }).click();

  // Invite the colleague from the onboarding step, then let them join.
  await owner.getByRole("heading", { name: /Mời đồng nghiệp/ }).waitFor();
  await owner.getByLabel("Email đồng nghiệp").fill(memberEmail);
  await owner.keyboard.press("Enter");
  await owner.getByRole("button", { name: "Gửi lời mời" }).click();
  await owner.getByRole("button", { name: "Hoàn tất" }).click();
  await expect(owner).toHaveURL(new RegExp(`/${orgSlug}/doi-danh-ba/tasks$`), { timeout: 15_000 });
  await owner.getByRole("button", { name: "Đã hiểu" }).click();

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await registerInvitee(member, "Nguyễn Văn Ân", memberEmail);
  await member.goto("/invitations");
  await member.getByRole("button", { name: /Tham gia|Chấp nhận/ }).first().click();
  await expect(member).toHaveURL(new RegExp(`/${orgSlug}/doi-danh-ba/`), { timeout: 20_000 });

  // The owner creates a department and puts the colleague in it.
  await owner.goto(`/${orgSlug}/doi-danh-ba/settings?tab=departments`);
  await owner.getByLabel("Tên phòng ban").fill("Kỹ thuật");
  await owner.getByRole("button", { name: "Thêm phòng ban" }).click();
  await expect(owner.getByText("1 thành viên", { exact: false })).toHaveCount(0);

  await owner.goto(`/${orgSlug}/doi-danh-ba/people`);
  await owner.getByRole("link", { name: /Nguyễn Văn Ân/ }).click();
  await owner.getByRole("button", { name: "Sửa hồ sơ" }).click();
  await owner.getByLabel("Chức danh").fill("Trưởng nhóm");
  await owner.getByLabel("Phòng ban").click();
  await owner.getByRole("option", { name: "Kỹ thuật" }).click();
  await owner.getByRole("button", { name: "Lưu" }).click();
  await expect(owner.getByText("Trưởng nhóm")).toBeVisible({ timeout: 15_000 });

  // The colleague finds them without typing a single diacritic.
  await member.goto(`/${orgSlug}/doi-danh-ba/people`);
  await member.getByRole("textbox", { name: "Tìm người" }).fill("nguyen van an");
  // The card carries the job title and the department as separate lines; only
  // the name is the link, so the card itself is the list item around it.
  const card = member.getByRole("listitem").filter({ hasText: "Nguyễn Văn Ân" });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText("Trưởng nhóm")).toBeVisible();
  await expect(card.getByText("Kỹ thuật")).toBeVisible();

  // Switching the colleague off closes the whole organization to them, even
  // though their workspace membership row is deliberately left in place. This
  // was their only organization, so their sessions end with it and the
  // workspace URL sends them to the sign-in page rather than into the app.
  await owner.goto(`/${orgSlug}/doi-danh-ba/settings?tab=organization`);
  await owner
    .getByRole("listitem")
    .filter({ hasText: memberEmail })
    .getByRole("button", { name: "Vô hiệu hóa" })
    .click();
  await expect(owner.getByText("Đã vô hiệu hóa thành viên")).toBeVisible({ timeout: 15_000 });

  await member.goto(`/${orgSlug}/doi-danh-ba/tasks`);
  await expect(member).toHaveURL(/\/login/, { timeout: 20_000 });

  await ownerContext.close();
  await memberContext.close();
});
