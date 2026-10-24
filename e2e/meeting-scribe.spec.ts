import { expect, test } from "@playwright/test";
import { createInstantMeeting, createRecordingAccount, loginViaUi } from "./meeting-recording-fixture";

// AI scribe (UNI-2023, spec 2026-10-20-meeting-scribe-agent-design §12.1): the
// host starts a meeting, the agent joins, captions show, finals are stored.
// Needs LiveKit (E2E_LIVEKIT=1), the server with MEETING_SCRIBE_ENABLED=true
// and FF_MEETING_SCRIBE=true, and apps/meeting-agent running with
// SCRIBE_STT_PROVIDER=fake (E2E_SCRIBE=1), and E2E_SCRIBE_AUDIO (below). The
// fake STT turns voiced audio into "từ1 từ2 …". Not in the default suite.
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const enabled = process.env.E2E_LIVEKIT === "1" && process.env.E2E_SCRIBE === "1" && !!process.env.E2E_SCRIBE_AUDIO;

// Chromium's default fake microphone is a beep, which Silero VAD does not
// take for speech; E2E_SCRIBE_AUDIO names a WAV of someone talking (macOS:
// `say -o speech.wav --data-format=LEI16@48000 "…"`), looped as the mic.
const audio = process.env.E2E_SCRIBE_AUDIO;
test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      ...(audio ? [`--use-file-for-fake-audio-capture=${audio}`] : []),
    ],
  },
});

test.describe("meeting AI scribe", () => {
  test.skip(!enabled, "set E2E_LIVEKIT=1, E2E_SCRIBE=1 and E2E_SCRIBE_AUDIO with LiveKit and apps/meeting-agent running");

  test("the agent joins, captions the room and stores the transcript", async ({ page }) => {
    test.setTimeout(180_000);
    const host = await createRecordingAccount(page, API, "scribe-host");
    const meeting = await createInstantMeeting(page, API, host.token, host.wsId, `Scribe ${host.wsId}`);

    await loginViaUi(page, host.email);
    await page.goto(`/${host.orgSlug}/${host.wsSlug}/meetings/${meeting.id}`);
    await page.getByRole("button", { name: "Vào phòng họp" }).click();
    await expect(page.getByTestId("meeting-prejoin")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Vào phòng|Tham gia/i }).last().click();
    await expect(page.getByTestId("meeting-stage")).toBeVisible({ timeout: 30_000 });

    // The 15 s sweep dispatches once someone is in the room.
    await expect(page.getByTestId("meeting-scribe-chip")).toContainText("UNI đang ghi lời", { timeout: 60_000 });
    // The agent is not a person: it gets no tile (the copilot panel is also titled "UniWork AI").
    await expect(page.getByTestId("meeting-stage-content").getByText("UniWork AI", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Phụ đề" }).first().click();
    await expect(page.getByTestId("meeting-scribe-captions")).toContainText("từ1", { timeout: 60_000 });

    await expect
      .poll(
        async () => {
          const res = await page.request.get(`${API}/api/v1/meetings/${meeting.id}/transcript`, {
            headers: { authorization: `Bearer ${host.token}` },
          });
          const body = (await res.json()) as { segments?: { text: string }[] };
          return (body.segments ?? []).some((s) => s.text.includes("từ1"));
        },
        { timeout: 60_000 },
      )
      .toBe(true);
  });
});
