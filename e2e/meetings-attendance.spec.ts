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
test("attendance: secretary marks in the roll drawer, finalize locks and shows in the history", async ({ page }) => {
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

  // The secretary runs the roll from the rail's "Điểm danh" row, in its drawer.
  await loginViaUi(page, member.email);
  await page.goto(`/${host.orgSlug}/${host.wsSlug}/meetings/${meeting.id}`);
  await page.getByRole("button", { name: /^Điểm danh:/ }).click({ timeout: 30_000 });
  const drawer = page.getByRole("dialog", { name: /^Điểm danh · 2 người/ });
  await expect(drawer.getByText("Biểu quyết tính trên 0 người: 0 có mặt, 0 muộn")).toBeVisible({ timeout: 30_000 });

  for (const name of ["att-host", "att-member"]) {
    // Base UI keeps a popup mounted while it animates out; open the next one only
    // once the last has gone, or its options are the ones the locator finds.
    await expect(page.locator('[role="listbox"]:visible')).toHaveCount(0);
    const status = drawer.getByRole("combobox", { name: new RegExp(`^Trạng thái của ${name}`) });
    await status.click();
    await page.getByRole("option", { name: "Có mặt", exact: true }).filter({ visible: true }).click();
    await expect(status).toContainText("Có mặt");
  }
  await expect(drawer.getByText("Biểu quyết tính trên 2 người: 2 có mặt, 0 muộn")).toBeVisible();
  await drawer.getByRole("button", { name: "Chốt điểm danh" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Chốt điểm danh" }).click();
  await expect(drawer.getByText(/Đã chốt lúc/)).toBeVisible();
  // Finalized means locked: no picker until someone reopens the roll.
  await expect(drawer.getByRole("combobox")).toHaveCount(0);
  const refused = await page.request.put(`${api}/api/v1/meetings/${meeting.id}/attendance/${memberPid}`, {
    headers: memberAuth,
    data: { status: "ABSENT" },
  });
  expect(refused.status(), "a finalized roll refuses marks until reopened").toBe(409);

  // The history drawer (the rail's "Lịch sử thao tác") records it.
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "Lịch sử thao tác", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Lịch sử thao tác" });
  await expect(history.getByText("att-member đã chốt điểm danh", { exact: true })).toBeVisible();
});
