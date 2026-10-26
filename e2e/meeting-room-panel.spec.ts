import { expect, test, type Page } from "@playwright/test";
import { createInstantMeeting, createRecordingAccount, loginViaUi, type RecordingAccount } from "./meeting-recording-fixture";

// The redesigned room panel (UNI-2173): the icon tab row, the UNI tab's one
// composer writing a note into the feed, the view switch, the People tab, and
// the bottom sheet on a phone. Needs LiveKit (E2E_LIVEKIT=1) and `make start`.
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const livekitEnabled = process.env.E2E_LIVEKIT === "1";

test.use({
  permissions: ["camera", "microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

async function enterRoom(page: Page, tag: string): Promise<RecordingAccount> {
  const host = await createRecordingAccount(page, API, tag);
  const meeting = await createInstantMeeting(page, API, host.token, host.wsId, `Họp bảng phụ ${tag}`);
  await loginViaUi(page, host.email);
  await page.goto(`/${host.orgSlug}/${host.wsSlug}/meetings/${meeting.id}`);
  await page.getByRole("button", { name: "Vào phòng họp" }).click();
  await expect(page.getByTestId("meeting-prejoin")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Vào phòng|Tham gia/i }).last().click();
  await expect(page.getByTestId("meeting-stage")).toBeVisible({ timeout: 30_000 });
  return host;
}

test.describe("the room panel", () => {
  test.skip(!livekitEnabled, "set E2E_LIVEKIT=1 with LiveKit running");

  test.describe("docked", () => {
    // From 1280px the side panel starts docked.
    test.use({ viewport: { width: 1440, height: 900 } });

    test("the host writes a note into the UNI feed, switches views and finds themself in People", async ({ page }) => {
      test.slow();
      await enterRoom(page, "panel-host");

      const tabs = page.getByRole("tablist", { name: "Bảng phụ cuộc họp" });
      // UNI, chat, people and votes (a host is a clerk); recordings now live in the UNI feed.
      await expect(tabs.getByRole("tab")).toHaveCount(4, { timeout: 15_000 });
      await expect(tabs.getByRole("tab", { name: /^Bản ghi/ })).toHaveCount(0);
      await expect(tabs.getByRole("tab", { name: "UNI" })).toHaveAttribute("aria-selected", "true");

      const uni = page.getByRole("tabpanel", { name: "UNI" });
      await uni.getByRole("radiogroup", { name: "Chế độ ô nhập" }).getByRole("radio", { name: "Ghi chú" }).click();
      const note = uni.getByRole("textbox", { name: "Ghi chú cho cả phòng" });
      await note.fill("Chốt lịch thứ Sáu");
      await note.press("Enter");
      await expect(note).toHaveValue("");
      await expect(uni.getByTestId("meeting-copilot-scroll").getByText("Chốt lịch thứ Sáu")).toBeVisible({ timeout: 15_000 });

      const views = uni.getByRole("radiogroup", { name: "Cách xem" });
      await views.getByRole("radio", { name: "Lời thoại" }).click();
      await expect(uni.getByRole("button", { name: "Tìm trong lời thoại" })).toBeVisible();
      await expect(uni.getByTestId("meeting-copilot-scroll")).toHaveCount(0);
      await views.getByRole("radio", { name: "Tổng hợp" }).click();
      await expect(uni.getByTestId("meeting-copilot-scroll").getByText("Chốt lịch thứ Sáu")).toBeVisible();

      await tabs.getByRole("tab", { name: /^Mọi người/ }).click();
      const people = page.getByRole("tabpanel", { name: "Mọi người" });
      await expect(people.getByText("panel-host", { exact: true }).first()).toBeVisible();
      await expect(people.getByText("bạn", { exact: true })).toBeVisible();
    });
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test("the panel opens as a bottom sheet whose tab row never scrolls sideways", async ({ page }) => {
      test.slow();
      await enterRoom(page, "panel-phone");

      await page.getByRole("button", { name: "Mở bảng phụ" }).click();
      const sheet = page.getByRole("dialog", { name: "Bảng phụ cuộc họp" });
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAttribute("data-side", "bottom");
      const tabs = sheet.getByRole("tablist", { name: "Bảng phụ cuộc họp" });
      await expect(tabs.getByRole("tab")).toHaveCount(4);
      const fits = await tabs.evaluate((el) => el.scrollWidth <= el.clientWidth);
      expect(fits).toBe(true);
    });
  });
});
