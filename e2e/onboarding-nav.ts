import { expect, type Page } from "@playwright/test";

/**
 * Điều hướng dùng chung cho các spec onboarding.
 *
 * Trước đây `onboarding-focus` và `onboarding-mobile` mỗi bên tự có một
 * `reachAboutYou` rồi DỪNG ở đó: chỉ báo focus và vùng chạm 44px chưa từng được
 * đo ở bước Tổ chức, Workspace hay Mời — tức 3/4 luồng. Hai control phức tạp
 * nhất (pill slug, khung chip email) nằm đúng trong phần không được đo, và một
 * lỗi focus đã sống sót ở đó. Một helper đi được tới BẤT KỲ bước nào là cách
 * duy nhất để các spec đó phủ hết mà không nhân bản kịch bản đăng ký.
 */
export const ONBOARDING_STEPS = ["about_you", "organization", "workspace", "invite"] as const;
export type OnboardingStepName = (typeof ONBOARDING_STEPS)[number];

/** Tên tổ chức/workspace sinh theo tag để hai spec chạy song song không đụng slug. */
export interface OnboardingRun {
  stamp: number;
  orgName: string;
  wsName: string;
}

export async function registerAndStart(page: Page, tag: string): Promise<OnboardingRun> {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill(tag);
  await page.getByLabel("Email").fill(`${tag.toLowerCase()}-${stamp}@example.com`);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByText("Cho chúng tôi biết đôi chút về bạn.").waitFor();
  return { stamp, orgName: `${tag} ${stamp}`, wsName: `Đội ${tag}` };
}

/**
 * Đi hết luồng MỘT lần, gọi `visit` tại mỗi bước.
 *
 * Một test cho mỗi bước thì cô lập lỗi tốt hơn, nhưng mỗi test là một lần đăng
 * ký đầy đủ: hai spec này nhân số lượt register lên gấp ~4 và đẩy lần chờ biên
 * dịch route của Next dev qua ngưỡng chờ mặc định. `onboarding-shell` và
 * `onboarding-contrast` đều đã phủ cả bốn bước bằng một lượt đi duy nhất — đây
 * là cùng hình dạng đó, và nhãn `step` giữ lại phần định vị lỗi.
 */
export async function walkOnboarding(
  page: Page,
  tag: string,
  visit: (step: OnboardingStepName, run: OnboardingRun) => Promise<void>,
): Promise<void> {
  const run = await registerAndStart(page, tag);
  await visit("about_you", run);

  await page.getByRole("radio", { name: "Kỹ sư / phát triển" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("heading", { name: "Đặt tên tổ chức của bạn." }).waitFor();
  await visit("organization", run);

  await page.getByLabel("Tên tổ chức").fill(run.orgName);
  await page.getByRole("button", { name: `Tạo ${run.orgName}` }).click();
  await page.getByRole("heading", { name: "Đặt tên workspace." }).waitFor();
  await visit("workspace", run);

  await page.getByLabel("Tên workspace").fill(run.wsName);
  await page.getByRole("button", { name: `Tạo ${run.wsName}` }).click();
  await page.getByRole("heading", { name: /Mời đồng nghiệp/ }).waitFor();
  await page.getByLabel("Email đồng nghiệp").fill(`invitee-${run.stamp}@example.com`);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Gửi lời mời" }).click();
  await page.getByRole("button", { name: "Sao chép" }).first().waitFor();
  await visit("invite", run);
}

/**
 * Đưa trang tới `target`, dừng lại ở đúng bước đó với nội dung đã dựng sẵn:
 * bước Mời được điền chip email và GỬI một lời mời, vì danh sách link đã gửi
 * (nút sao chép trong `InviteRow`) chỉ tồn tại sau khi gửi.
 */
export async function reachStep(page: Page, target: OnboardingStepName, tag: string): Promise<OnboardingRun> {
  const run = await registerAndStart(page, tag);
  if (target === "about_you") return run;

  await page.getByRole("radio", { name: "Kỹ sư / phát triển" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("heading", { name: "Đặt tên tổ chức của bạn." }).waitFor();
  if (target === "organization") return run;

  await page.getByLabel("Tên tổ chức").fill(run.orgName);
  await page.getByRole("button", { name: `Tạo ${run.orgName}` }).click();
  await page.getByRole("heading", { name: "Đặt tên workspace." }).waitFor();
  if (target === "workspace") return run;

  await page.getByLabel("Tên workspace").fill(run.wsName);
  await page.getByRole("button", { name: `Tạo ${run.wsName}` }).click();
  await page.getByRole("heading", { name: /Mời đồng nghiệp/ }).waitFor();

  // Chip trước, rồi gửi: chip dựng ra nút xoá của mỗi chip, còn lần gửi dựng ra
  // danh sách `InviteRow` với nút sao chép. Cả hai đều là vùng chạm và điểm
  // dừng Tab mà không spec nào từng chạm tới.
  await page.getByLabel("Email đồng nghiệp").fill(`invitee-${run.stamp}@example.com`);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Gửi lời mời" }).click();
  await page.getByRole("button", { name: "Sao chép" }).first().waitFor();
  return run;
}
