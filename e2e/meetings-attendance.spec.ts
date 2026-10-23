import { expect, test } from "@playwright/test";
import {
  createInstantMeeting,
  createRecordingAccount,
  joinWorkspaceAsMember,
  loginViaUi,
  registerApiUser,
} from "./meeting-recording-fixture";

// Attendance without LiveKit: nobody's client opens a room session locally,
// so the roll starts all-absent and the secretary marks people by hand - the
// same path a real clerk uses. Needs `make start`.
test("attendance: secretary marks, quorum warns, finalize locks and shows on the timeline", async ({ page }) => {
  // The first visit to a workspace route compiles it under `next dev`.
  test.slow();
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  const host = await createRecordingAccount(page, api, "att-host");
  const member = await registerApiUser(page, api, "att-member");
  await joinWorkspaceAsMember(page, api, host.token, host.wsId, member);
  const memberAuth = { authorization: `Bearer ${member.token}`, "content-type": "application/json" };
  const onboarded = await page.request.post(`${api}/api/v1/me/onboarding/complete`, {
    headers: memberAuth,
    data: { completion_path: "full", workspace_id: host.wsId },
  });
  expect(onboarded.ok(), `member onboarding: HTTP ${onboarded.status()} ${await onboarded.text()}`).toBeTruthy();

  const meeting = await createInstantMeeting(page, api, host.token, host.wsId, "Giao ban e2e");
  const hostAuth = { authorization: `Bearer ${host.token}`, "content-type": "application/json" };
  const me = await page.request.get(`${api}/api/v1/me`, { headers: memberAuth });
  expect(me.ok()).toBeTruthy();
  const memberUserId = ((await me.json()) as { user: { id: string } }).user.id;
  const invited = await page.request.post(`${api}/api/v1/meetings/${meeting.id}/invitations`, {
    headers: hostAuth,
    data: { user_id: memberUserId },
  });
  expect(invited.ok(), `invite to meeting: HTTP ${invited.status()} ${await invited.text()}`).toBeTruthy();
  const memberPid = ((await invited.json()) as { participant: { id: string } }).participant.id;
  const quorum = await page.request.patch(`${api}/api/v1/meetings/${meeting.id}`, {
    headers: hostAuth,
    data: { quorum_percent: 60 },
  });
  expect(quorum.ok(), `set quorum: HTTP ${quorum.status()} ${await quorum.text()}`).toBeTruthy();
  const secretary = await page.request.patch(`${api}/api/v1/meetings/${meeting.id}/participants/${memberPid}`, {
    headers: hostAuth,
    data: { is_secretary: true },
  });
  expect(secretary.ok(), `appoint secretary: HTTP ${secretary.status()} ${await secretary.text()}`).toBeTruthy();

  // The secretary runs the roll on the detail page.
  await loginViaUi(page, member.email);
  await page.goto(`/${host.orgSlug}/${host.wsSlug}/meetings/${meeting.id}`);
  // PanelCard is a <section aria-labelledby="attendance-heading">.
  const card = page.getByRole("region", { name: "Điểm danh" });
  await expect(card.getByText("Chưa đủ tỉ lệ: cần 60%, còn thiếu 2 người")).toBeVisible({ timeout: 30_000 });

  for (const name of ["att-host", "att-member"]) {
    // Base UI keeps a popup mounted while it animates out; open the next one only
    // once the last has gone, or its options are the ones the locator finds.
    await expect(page.locator('[role="listbox"]:visible')).toHaveCount(0);
    await card.getByRole("combobox", { name: `Trạng thái điểm danh của ${name}` }).click();
    await page.getByRole("option", { name: "Có mặt", exact: true }).filter({ visible: true }).click();
    await expect(card.getByRole("combobox", { name: `Trạng thái điểm danh của ${name}` })).toContainText("Có mặt");
  }
  await expect(card.getByText("Đủ tỉ lệ (cần 60%)")).toBeVisible();
  await card.getByRole("button", { name: "Chốt điểm danh" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Chốt điểm danh" }).click();
  await expect(card.getByText(/Đã chốt lúc/)).toBeVisible();
  // Finalized means locked: no picker until someone reopens the roll.
  await expect(card.getByRole("combobox")).toHaveCount(0);
  const refused = await page.request.put(`${api}/api/v1/meetings/${meeting.id}/attendance/${memberPid}`, {
    headers: memberAuth,
    data: { status: "ABSENT" },
  });
  expect(refused.status(), "a finalized roll refuses marks until reopened").toBe(409);
  // exact: the toast says "Đã chốt điểm danh" too.
  await expect(page.getByText("đã chốt điểm danh", { exact: true })).toBeVisible();
});
