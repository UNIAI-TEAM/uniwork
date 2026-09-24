import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { register, verifyEmail } from "./auth-nav";
import { seedCompletedMeetingRecording, writeLocalObject } from "./db";
import {
  createInstantMeeting,
  createRecordingAccount,
  endMeeting,
  joinWorkspaceAsMember,
  loginViaUi,
  recordingContentUrl,
  registerApiUser,
} from "./meeting-recording-fixture";

// Meeting lifecycle without LiveKit: tạo → bắt đầu → panel tóm tắt AI hiện
// (kèm trạng thái AI tắt) → tải .ics → kết thúc → ENDED. Yêu cầu `make dev`.
const stamp = Date.now();

test("meeting: create → start → summary panel → ics → end", async ({ page }) => {
  await register(page, "E2E Meet", stamp);
  await verifyEmail(page);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Org M ${stamp}`);
  await page.getByRole("button", { name: `Tạo Org M ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill(`Đội M ${stamp}`);
  await page.getByRole("button", { name: `Tạo Đội M ${stamp}` }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/org-m-${stamp}/doi-m-${stamp}/tasks`), { timeout: 15_000 });
  await page.getByRole("button", { name: "Để sau" }).click({ timeout: 15_000 });

  await page.goto(`/org-m-${stamp}/doi-m-${stamp}/meetings`);
  // Header action and the empty-state CTA share the label; either opens the dialog.
  await page.getByRole("button", { name: "Tạo cuộc họp" }).first().click();
  await page.getByLabel("Tiêu đề").fill("Họp AI e2e");
  await page.getByRole("dialog").getByRole("button", { name: "Tạo cuộc họp", exact: true }).click();
  // Creating navigates to the detail page. 15s: under `next dev` the first
  // visit compiles /meetings/[meetingId], which alone can take longer than
  // the 5s default.
  await expect(page).toHaveURL(/\/meetings\/[0-9A-Z]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Họp AI e2e" })).toBeVisible();

  // Scheduled: no summary panel yet, calendar available.
  await expect(page.getByTestId("meeting-summary-panel")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Thêm vào lịch" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.ics$/);

  await page.getByRole("button", { name: "Bắt đầu" }).click();
  // exact: the activity timeline also renders "Đã lên lịch → Đang diễn ra".
  await expect(page.getByText("Đang diễn ra", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("meeting-summary-panel")).toBeVisible();
  // Without ANTHROPIC_API_KEY the panel explains that AI is off (or shows the
  // empty transcript hint when the key is set): either is a valid server state.
  await expect(
    page.getByText("Tóm tắt AI chưa được bật trên máy chủ này.").or(page.getByText(/Chưa có bản ghi lời thoại/)).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Kết thúc" }).click();
  await page.getByRole("button", { name: /Kết thúc/ }).last().click();
  await expect(page.getByText("Đã kết thúc").first()).toBeVisible({ timeout: 10_000 });
});

// ---- Recording (UNI-746) ---------------------------------------------------

/**
 * The provider path (LiveKit Egress start/stop and the signed webhook) runs in
 * meetings-livekit.spec.ts behind E2E_LIVEKIT=1 plus a recording bucket. This
 * case pins the rest of the lane on the real app with no provider in the loop:
 * a finished recording is listed, the player opens it, the proxy streams
 * exactly the bytes the provider wrote, a workspace member may read it and
 * another organization may not. Run it with E2E_RECORDING_S3=1 when the app
 * uses MinIO/S3 to also assert the seek path: the local backend has no byte
 * ranges and answers with the whole object.
 */
test("recording playback: listed, exact bytes, member reads, other org blocked @files-smoke", async ({ page }) => {
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  const seed = await createRecordingAccount(page, api, "rec-host");
  const meeting = await createInstantMeeting(page, api, seed.token, seed.wsId, `Bản ghi ${seed.wsId}`);
  await endMeeting(page, api, seed.token, meeting.id);

  // What a finished egress leaves behind: the MP4 in storage and its COMPLETE
  // row - the webhook's own job, which the LiveKit spec exercises for real.
  const key = `meetings/${seed.wsId}/${meeting.id}-e2e.mp4`;
  const bytes = readFileSync(new URL("./fixtures/meeting-recording.mp4", import.meta.url));
  await writeLocalObject(key, bytes);
  const recordingId = await seedCompletedMeetingRecording(meeting.id, `${api}/uploads/${key}`);

  // The session a viewer signs in with; the API token above still drives the
  // seeding and the isolation cases.
  await loginViaUi(page, seed.email);
  await page.goto(`/${seed.orgSlug}/${seed.wsSlug}/meetings`);
  const rewatch = page.getByRole("button", { name: "Xem lại" }).first();
  await expect(rewatch).toBeVisible({ timeout: 20_000 });

  // Download: byte for byte, then the Range behaviour of this backend.
  const content = recordingContentUrl(api, meeting.id, recordingId);
  const full = await page.request.get(content, { headers: { authorization: `Bearer ${seed.token}` } });
  expect(full.status()).toBe(200);
  expect(Buffer.compare(await full.body(), bytes)).toBe(0);

  const ranged = await page.request.get(content, {
    headers: { authorization: `Bearer ${seed.token}`, range: "bytes=0-9" },
  });
  if (process.env.E2E_RECORDING_S3 === "1") {
    expect(ranged.status()).toBe(206);
    expect(ranged.headers()["content-range"]).toBe(`bytes 0-9/${bytes.length}`);
    expect((await ranged.body()).length).toBe(10);
  } else {
    expect(ranged.status()).toBe(200);
    expect((await ranged.body()).length).toBe(bytes.length);
  }

  // Play: the dialog decodes the recording in the browser.
  await rewatch.click();
  const video = page.locator("video");
  await expect(video).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => video.evaluate((el) => (el as HTMLVideoElement).duration), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // A workspace member who never joined the room may still read it...
  const member = await registerApiUser(page, api, "rec-member");
  await joinWorkspaceAsMember(page, api, seed.token, seed.wsId, member);
  const asMember = await page.request.get(content, { headers: { authorization: `Bearer ${member.token}` } });
  expect(asMember.status()).toBe(200);

  // ...and a user from another organization who guessed the ids is refused.
  const outsider = await registerApiUser(page, api, "rec-outsider");
  const asOutsider = await page.request.get(content, { headers: { authorization: `Bearer ${outsider.token}` } });
  expect(asOutsider.status()).toBe(403);
});