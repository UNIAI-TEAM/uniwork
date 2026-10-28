import { expect, test, type Page } from "@playwright/test";
import { createInstantMeeting, createRecordingAccount, loginViaUi } from "./meeting-recording-fixture";

// In-person meeting recorder (UNI-2247, spec 2026-10-28-meeting-in-person-recorder-design):
// the clerk records from the browser into IndexedDB, and what is recorded
// outlives a reload. No LiveKit, no transcription provider: the capability is
// answered true here and nothing is sent. Needs `make start`.
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// Chromium's fake microphone; launch options are worker-scoped, so they live at the top of the file.
test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

/** Every recording control hides unless the organization can transcribe (spec D5): say it can. */
async function canTranscribe(page: Page): Promise<void> {
  await page.route("**/meeting-capabilities", async (route) => {
    const res = await route.fetch();
    const caps = (await res.json()) as Record<string, unknown>;
    await route.fulfill({ response: res, json: { ...caps, transcription: true } });
  });
}

/** "1:02:03" or "0:03" → seconds. */
function seconds(clock: string): number {
  return clock
    .trim()
    .split(":")
    .reduce((total, part) => total * 60 + Number(part), 0);
}

test.describe("in-person meeting recorder", () => {
  test("records an in-person meeting and keeps it across a reload", async ({ page }) => {
    test.setTimeout(120_000);
    // The recorder asks before the page unloads mid-recording; the reload is the point here.
    page.on("dialog", (dialog) => void dialog.accept());
    const host = await createRecordingAccount(page, API, "in-person");
    await canTranscribe(page);
    await loginViaUi(page, host.email);

    await page.goto(`/${host.orgSlug}/${host.wsSlug}/meetings`);
    await page.getByRole("button", { name: "Họp ngay" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /Trực tiếp/ }).click();
    await dialog.getByRole("button", { name: "Chuẩn bị ghi âm" }).click();
    // 15s: under `next dev` the first visit compiles the record page.
    await expect(page).toHaveURL(/\/meetings\/[0-9A-Z]+\/record$/, { timeout: 15_000 });
    const meetingUrl = page.url().replace(/\/record$/, "");

    await page.getByRole("checkbox", { name: /Tôi đã thông báo cho người dự họp/ }).click();
    const start = page.getByRole("button", { name: "Bắt đầu ghi âm" });
    // Gated until the device's earlier parts are known (aria-disabled, so it stays clickable).
    await expect(start).not.toHaveAttribute("aria-disabled", "true");
    await start.click();

    await expect(page.getByRole("status").filter({ hasText: "Đang ghi âm" })).toBeVisible({ timeout: 15_000 });
    const timer = page.getByRole("timer");
    await expect.poll(async () => seconds(await timer.innerText()), { timeout: 15_000 }).toBeGreaterThanOrEqual(3);

    await page.getByRole("button", { name: "Tạm dừng" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Đã tạm dừng" })).toBeVisible();

    await page.reload();
    await page.goto(meetingUrl);
    // The part stays open after a reload; the strip waits until no tab could still be writing it (15 s).
    await expect(page.getByText(/Còn bản ghi .+ chưa gửi trên máy này/)).toBeVisible({ timeout: 40_000 });
    await expect(page.getByRole("button", { name: "Kết thúc và gửi" })).toBeVisible();
  });

  test("an in-person meeting page offers Bắt đầu ghi âm, not a room", async ({ page }) => {
    const host = await createRecordingAccount(page, API, "in-person-page");
    const meeting = await createInstantMeeting(page, API, host.token, host.wsId, `Tại phòng ${host.wsId}`, "in_person");
    await canTranscribe(page);
    await loginViaUi(page, host.email);

    await page.goto(`/${host.orgSlug}/${host.wsSlug}/meetings/${meeting.id}`);
    await expect(page.getByRole("button", { name: "Bắt đầu ghi âm" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Vào phòng họp" })).toHaveCount(0);
  });
});
