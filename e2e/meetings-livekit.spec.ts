import { expect, test } from "@playwright/test";
import { register, verifyEmail } from "./auth-nav";
import { createInstantMeeting, createRecordingAccount, recordingContentUrl } from "./meeting-recording-fixture";

// LiveKit media smoke: requires LiveKit + E2E_LIVEKIT=1. Skipped in default CI
// (meetings.spec.ts covers lifecycle without LiveKit).
const livekitEnabled = process.env.E2E_LIVEKIT === "1";

test.describe("meeting livekit smoke", () => {
  test.skip(!livekitEnabled, "set E2E_LIVEKIT=1 with LiveKit running");

  test("instant meeting → prejoin → stage shell", async ({ page }) => {
    const stamp = Date.now();
    await register(page, "E2E LK", stamp);
    await verifyEmail(page);
    await page.getByRole("button", { name: /Bắt đầu/ }).click();
    await page.getByRole("button", { name: "Bỏ qua" }).click();
    await page.getByLabel("Tên tổ chức").fill(`Org LK ${stamp}`);
    await page.getByRole("button", { name: `Tạo Org LK ${stamp}` }).click();
    await page.getByLabel("Tên workspace").fill(`Đội LK ${stamp}`);
    await page.getByRole("button", { name: `Tạo Đội LK ${stamp}` }).click();
    await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
    await expect(page).toHaveURL(new RegExp(`/org-lk-${stamp}/doi-lk-${stamp}/tasks`), { timeout: 15_000 });
    await page.getByRole("button", { name: "Để sau" }).click({ timeout: 15_000 });

    await page.goto(`/org-lk-${stamp}/doi-lk-${stamp}/meetings`);
    await page.getByRole("button", { name: "Tạo cuộc họp" }).first().click();
    await page.getByLabel("Tiêu đề").fill("LiveKit smoke");
    await page.getByRole("dialog").getByRole("button", { name: "Tạo cuộc họp", exact: true }).click();
    await expect(page).toHaveURL(/\/meetings\/[0-9A-Z]+$/, { timeout: 15_000 });

    await page.getByRole("button", { name: "Bắt đầu" }).click();
    await expect(page.getByText("Đang diễn ra", { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Vào phòng họp" }).click();
    await expect(page.getByTestId("meeting-prejoin")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Vào phòng|Tham gia/i }).last().click();
    await expect(page.getByTestId("meeting-stage")).toBeVisible({ timeout: 30_000 });
  });
  /**
   * The real provider path: LiveKit Egress writes the MP4 into the recording
   * bucket, the signed egress_ended webhook completes the row, and playback
   * serves the object with byte ranges (what a player's seek uses). Needs
   * LIVEKIT_RECORDING_BUCKET with egress and MinIO, plus STORAGE_BACKEND=s3 so
   * the app reads the same bucket; the case skips itself with that reason when
   * the server reports recording off, so a plain `make start` shows the gap
   * instead of failing.
   */
  test("recording: egress writes the file, the webhook completes it, playback seeks", async ({ page }) => {
    const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
    const seed = await createRecordingAccount(page, api, "lkr-host");
    const capsRes = await page.request.get(`${api}/api/v1/workspaces/${seed.wsId}/meeting-capabilities`, {
      headers: { authorization: `Bearer ${seed.token}` },
    });
    expect(capsRes.ok(), `meeting capabilities: HTTP ${capsRes.status()}`).toBeTruthy();
    const caps = (await capsRes.json()) as { recording: boolean };
    test.skip(
      !caps.recording,
      "server reports recording off: set LIVEKIT_RECORDING_BUCKET (+ egress, MinIO, STORAGE_BACKEND=s3) to run this",
    );

    const meeting = await createInstantMeeting(page, api, seed.token, seed.wsId, `Ghi hình ${seed.wsId}`);
    const auth = { authorization: `Bearer ${seed.token}`, "content-type": "application/json" };
    // The host joins first so the room exists: Egress records a LiveKit room.
    const joined = await page.request.post(`${api}/api/v1/meetings/${meeting.id}/join`, { headers: auth, data: {} });
    expect(joined.ok(), `join: HTTP ${joined.status()}`).toBeTruthy();

    const started = await page.request.post(`${api}/api/v1/meetings/${meeting.id}/recording/start`, { headers: auth });
    expect(started.ok(), `start recording: HTTP ${started.status()} ${await started.text()}`).toBeTruthy();
    const { recording } = (await started.json()) as { recording: { id: string; status: string } };
    expect(recording.status).toBe("ACTIVE");

    await page.waitForTimeout(5_000);
    const stopped = await page.request.post(`${api}/api/v1/meetings/${meeting.id}/recording/stop`, { headers: auth });
    expect(stopped.ok(), `stop recording: HTTP ${stopped.status()} ${await stopped.text()}`).toBeTruthy();

    // Egress uploads after the stop; the signed webhook then completes the row
    // with the object URL.
    let fileUrl = "";
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`${api}/api/v1/meetings/${meeting.id}/recordings`, { headers: auth });
          if (!res.ok()) return `HTTP ${res.status()}`;
          const { recordings } = (await res.json()) as {
            recordings: { id: string; status: string; file_url: string }[];
          };
          const row = recordings.find((r) => r.id === recording.id);
          fileUrl = row?.file_url ?? "";
          return row?.status ?? "missing";
        },
        { timeout: 120_000, intervals: [2_000] },
      )
      .toBe("COMPLETE");
    expect(fileUrl).not.toBe("");

    const content = recordingContentUrl(api, meeting.id, recording.id);
    const full = await page.request.get(content, { headers: { authorization: `Bearer ${seed.token}` } });
    expect(full.status()).toBe(200);
    expect((await full.body()).length).toBeGreaterThan(0);

    // Seek: the playback route slices the object for a byte range.
    const ranged = await page.request.get(content, {
      headers: { authorization: `Bearer ${seed.token}`, range: "bytes=0-99" },
    });
    expect(ranged.status()).toBe(206);
    expect(ranged.headers()["content-range"]).toMatch(/^bytes 0-99\/\d+$/);
    expect((await ranged.body()).length).toBe(100);
  });
});

