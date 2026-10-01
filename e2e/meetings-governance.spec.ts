import { expect, test, type APIResponse, type Page } from "@playwright/test";
import {
  createInstantMeeting,
  createRecordingAccount,
  joinWorkspaceAsMember,
  loginViaUi,
  registerApiUser,
  type ApiUser,
  type RecordingAccount,
  type SeededMeeting,
} from "./meeting-recording-fixture";

// Voting without LiveKit webhooks: no room session reaches the roll locally,
// so the host marks both members present by hand - the clerk's own path -
// before an item opens. Needs `make start`.
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const livekitEnabled = process.env.E2E_LIVEKIT === "1";

// The room case publishes Chromium's fake camera and microphone; the
// detail-page case never asks for media, so the flags cost it nothing.
// Launch options are worker-scoped, so they live at the top of the file.
test.use({
  permissions: ["camera", "microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

type AuthHeaders = Record<string, string>;

interface GovernanceSeed {
  host: RecordingAccount;
  member: ApiUser;
  meeting: SeededMeeting;
  hostAuth: AuthHeaders;
  memberAuth: AuthHeaders;
}

interface MotionRow {
  id: string;
  title: string;
  status: string;
  roll_size: number | null;
  cast_count: number;
  result: { yes: number; no: number; abstain: number; required: number; outcome: string } | null;
  voters: { yes: string[]; no: string[]; abstain: string[] } | null;
  my_ballot: { on_roll: boolean; cast: boolean; choice: string | null };
}

function bearer(token: string): AuthHeaders {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function errorCode(res: APIResponse): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

/** Host + one workspace member in a live meeting, both on the roll as present. */
async function seedGovernance(
  page: Page,
  tag: string,
  opts: { secretary: boolean; quorumPercent?: number },
): Promise<GovernanceSeed> {
  const host = await createRecordingAccount(page, API, `${tag}-host`);
  const member = await registerApiUser(page, API, `${tag}-member`);
  await joinWorkspaceAsMember(page, API, host.token, host.wsId, member);
  const hostAuth = bearer(host.token);
  const memberAuth = bearer(member.token);
  const onboarded = await page.request.post(`${API}/api/v1/me/onboarding/complete`, {
    headers: memberAuth,
    data: { completion_path: "full", workspace_id: host.wsId },
  });
  expect(onboarded.ok(), `member onboarding: HTTP ${onboarded.status()} ${await onboarded.text()}`).toBeTruthy();

  const meeting = await createInstantMeeting(page, API, host.token, host.wsId, `Họp biểu quyết ${tag}`);
  const me = await page.request.get(`${API}/api/v1/me`, { headers: memberAuth });
  expect(me.ok()).toBeTruthy();
  const memberUserId = ((await me.json()) as { user: { id: string } }).user.id;
  const invited = await page.request.post(`${API}/api/v1/meetings/${meeting.id}/invitations`, {
    headers: hostAuth,
    data: { user_id: memberUserId },
  });
  expect(invited.ok(), `invite to meeting: HTTP ${invited.status()} ${await invited.text()}`).toBeTruthy();
  const memberPid = ((await invited.json()) as { participant: { id: string } }).participant.id;
  if (opts.quorumPercent !== undefined) {
    const quorum = await page.request.patch(`${API}/api/v1/meetings/${meeting.id}`, {
      headers: hostAuth,
      data: { quorum_percent: opts.quorumPercent },
    });
    expect(quorum.ok(), `set quorum: HTTP ${quorum.status()} ${await quorum.text()}`).toBeTruthy();
  }
  if (opts.secretary) {
    const appointed = await page.request.patch(`${API}/api/v1/meetings/${meeting.id}/participants/${memberPid}`, {
      headers: hostAuth,
      data: { is_secretary: true },
    });
    expect(appointed.ok(), `appoint secretary: HTTP ${appointed.status()} ${await appointed.text()}`).toBeTruthy();
  }

  // The roll an item snapshots when it opens: every member marked present.
  const roll = await page.request.get(`${API}/api/v1/meetings/${meeting.id}/attendance`, { headers: hostAuth });
  expect(roll.ok(), `attendance: HTTP ${roll.status()} ${await roll.text()}`).toBeTruthy();
  const { rows } = (await roll.json()) as { rows: { participant_id: string; standing: string }[] };
  const members = rows.filter((r) => r.standing === "MEMBER");
  expect(members.map((r) => r.participant_id)).toContain(memberPid);
  expect(members).toHaveLength(2);
  for (const row of members) {
    const marked = await page.request.put(`${API}/api/v1/meetings/${meeting.id}/attendance/${row.participant_id}`, {
      headers: hostAuth,
      data: { status: "PRESENT" },
    });
    expect(marked.ok(), `mark present: HTTP ${marked.status()} ${await marked.text()}`).toBeTruthy();
  }
  return { host, member, meeting, hostAuth, memberAuth };
}

async function castBallot(page: Page, meetingId: string, motionId: string, auth: AuthHeaders, choice: string) {
  return page.request.post(`${API}/api/v1/meetings/${meetingId}/motions/${motionId}/ballot`, {
    headers: auth,
    data: { choice },
  });
}

async function findMotion(page: Page, meetingId: string, auth: AuthHeaders, title: string): Promise<MotionRow> {
  const res = await page.request.get(`${API}/api/v1/meetings/${meetingId}/motions`, { headers: auth });
  expect(res.ok(), `list motions: HTTP ${res.status()} ${await res.text()}`).toBeTruthy();
  const { motions } = (await res.json()) as { motions: MotionRow[] };
  const motion = motions.find((m) => m.title === title);
  expect(motion, `motion "${title}" listed`).toBeDefined();
  return motion as MotionRow;
}

test("votes: the secretary drafts, opens and closes an item; the result reaches the detail page and the timeline", async ({ page }) => {
  // The first visit to a workspace route compiles it under `next dev`.
  test.slow();
  const seed = await seedGovernance(page, "gov", { secretary: true, quorumPercent: 50 });
  const { meeting, hostAuth, memberAuth } = seed;
  const title = `Kế hoạch quý IV ${Date.now()}`;

  await loginViaUi(page, seed.member.email);
  await page.goto(`/${seed.host.orgSlug}/${seed.host.wsSlug}/meetings/${meeting.id}`);
  // PanelCard is a <section aria-labelledby="motions-heading">.
  const card = page.getByRole("region", { name: "Biểu quyết", exact: true });
  await expect(
    card.getByText("Chưa có nội dung biểu quyết. Soạn trước, mở từng nội dung khi đang họp."),
  ).toBeVisible({ timeout: 30_000 });

  // Draft with the defaults: open ballot, majority, of members present.
  await card.getByRole("button", { name: "Thêm nội dung" }).click();
  const form = page.getByRole("dialog", { name: "Thêm nội dung biểu quyết" });
  await form.getByLabel("Nội dung", { exact: true }).fill(title);
  await form.getByRole("button", { name: "Thêm", exact: true }).click();
  await expect(form).toBeHidden();
  await expect(card.getByText(title, { exact: true })).toBeVisible();
  await expect(card.getByText("Nháp", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Mở biểu quyết", exact: true }).click();
  const openConfirm = page.getByRole("alertdialog");
  await expect(openConfirm.getByText("2 thành viên có mặt sẽ được bỏ phiếu.")).toBeVisible();
  await expect(openConfirm.getByText("Người vào phòng sau khi mở sẽ không được bỏ phiếu nội dung này.")).toBeVisible();
  // Both members present against a 50% minimum: no quorum warning.
  await expect(openConfirm.getByText(/Chưa đủ tỉ lệ có mặt tối thiểu/)).toHaveCount(0);
  await openConfirm.getByRole("button", { name: "Mở biểu quyết", exact: true }).click();
  await expect(openConfirm).toBeHidden();
  await expect(card.getByText("Đang bỏ phiếu", { exact: true })).toBeVisible();
  await expect(card.getByText("Đã bỏ phiếu 0/2")).toBeVisible();
  // The detail page shows progress only; ballots are cast from the room.
  await expect(card.getByText("Bỏ phiếu trong phòng họp.")).toBeVisible();
  await expect(card.getByRole("radio")).toHaveCount(0);

  const open = await findMotion(page, meeting.id, hostAuth, title);
  expect(open.status).toBe("OPEN");
  expect(open.roll_size).toBe(2);
  // Host first, then member: public voters are listed in cast order.
  for (const auth of [hostAuth, memberAuth]) {
    const cast = await castBallot(page, meeting.id, open.id, auth, "YES");
    expect(cast.ok(), `ballot: HTTP ${cast.status()} ${await cast.text()}`).toBeTruthy();
  }
  // A second ballot (double click, a second tab) is refused and never counted.
  const again = await castBallot(page, meeting.id, open.id, hostAuth, "NO");
  expect(again.status()).toBe(409);
  expect(await errorCode(again)).toBe("already_voted");
  // While the item is open nobody sees the tally, the host included.
  const counting = await findMotion(page, meeting.id, hostAuth, title);
  expect(counting.cast_count).toBe(2);
  expect(counting.result).toBeNull();
  expect(counting.my_ballot).toEqual({ on_roll: true, cast: true, choice: "YES" });
  // motion.ballot_cast reaches the open page through realtime, not a reload.
  await expect(card.getByText("Đã bỏ phiếu 2/2")).toBeVisible({ timeout: 15_000 });

  await card.getByRole("button", { name: "Đóng biểu quyết", exact: true }).click();
  const closeConfirm = page.getByRole("alertdialog");
  await expect(closeConfirm.getByText("Kết quả được kiểm ngay và không thay đổi được nữa.")).toBeVisible();
  await closeConfirm.getByRole("button", { name: "Đóng biểu quyết", exact: true }).click();
  await expect(closeConfirm).toBeHidden();
  await expect(card.getByText("Đã đóng", { exact: true })).toBeVisible();
  await expect(card.getByText("Thông qua", { exact: true })).toBeVisible();
  await expect(card.getByText("Tán thành: 2 (100%)", { exact: true })).toBeVisible();
  await expect(card.getByText("Không tán thành: 0 (0%)", { exact: true })).toBeVisible();
  await expect(card.getByText("Cần 2/2 phiếu tán thành", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Xem ai chọn gì" }).click();
  await expect(card.getByText("gov-host, gov-member", { exact: true })).toBeVisible();

  const late = await castBallot(page, meeting.id, open.id, memberAuth, "NO");
  expect(late.status()).toBe(409);
  expect(await errorCode(late)).toBe("motion_not_open");
  const closed = await findMotion(page, meeting.id, memberAuth, title);
  expect(closed.result).toEqual({ yes: 2, no: 0, abstain: 0, required: 2, outcome: "PASSED" });
  expect(closed.voters?.yes).toEqual(expect.arrayContaining(["gov-host", "gov-member"]));
  expect(closed.voters?.no).toEqual([]);

  // "Đã biểu quyết" renders from the closed item even with no AI summary.
  const summary = page.getByRole("region", { name: "Tóm tắt AI" });
  await expect(summary.getByText("Đã biểu quyết", { exact: true })).toBeVisible();
  await expect(summary.getByText(title, { exact: true })).toBeVisible();
  await expect(summary.getByText("2 tán thành · 0 không tán thành · 0 không ý kiến", { exact: true })).toBeVisible();

  // exact: the toasts say "Đã mở/đóng biểu quyết" too. The rail shows the
  // five newest rows, and these two are the newest.
  const timeline = page.getByRole("region", { name: "Lịch sử thao tác" });
  await expect(timeline.getByText("đã mở biểu quyết", { exact: true })).toBeVisible();
  await expect(timeline.getByText("đã đóng biểu quyết", { exact: true })).toBeVisible();
  await expect(timeline.getByText(`“${title}” · Thông qua`, { exact: true })).toBeVisible();
});

test.describe("votes in the meeting room", () => {
  test.skip(!livekitEnabled, "set E2E_LIVEKIT=1 with LiveKit running");
  // From 1280px the side panel starts docked, so the Votes tab is on screen.
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a member votes through the prompt card and the secret result reaches the room", async ({ page }) => {
    test.slow();
    const seed = await seedGovernance(page, "govlk", { secretary: false });
    const { meeting, hostAuth, memberAuth } = seed;
    const title = `Bầu thư ký ${Date.now()}`;
    const created = await page.request.post(`${API}/api/v1/meetings/${meeting.id}/motions`, {
      headers: hostAuth,
      data: { title, description: "", ballot_mode: "SECRET", threshold: "MAJORITY", base: "PRESENT" },
    });
    expect(created.ok(), `create motion: HTTP ${created.status()} ${await created.text()}`).toBeTruthy();
    const motionId = ((await created.json()) as { motion: { id: string } }).motion.id;
    // The host joins first so the room is live when the member arrives.
    const joined = await page.request.post(`${API}/api/v1/meetings/${meeting.id}/join`, { headers: hostAuth, data: {} });
    expect(joined.ok(), `host join: HTTP ${joined.status()}`).toBeTruthy();

    await loginViaUi(page, seed.member.email);
    await page.goto(`/${seed.host.orgSlug}/${seed.host.wsSlug}/meetings/${meeting.id}`);
    await page.getByRole("button", { name: "Vào phòng họp" }).click();
    await expect(page.getByTestId("meeting-prejoin")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Vào phòng|Tham gia/i }).last().click();
    await expect(page.getByTestId("meeting-stage")).toBeVisible({ timeout: 30_000 });
    // The tab strip is up; a draft belongs to the clerks, so a member has no Votes tab yet.
    await expect(page.getByRole("tab", { name: /^Trò chuyện/ })).toBeVisible({ timeout: 15_000 });
    const votesTab = page.getByRole("tab", { name: /^Biểu quyết/ });
    await expect(votesTab).toHaveCount(0);

    const opened = await page.request.post(`${API}/api/v1/meetings/${meeting.id}/motions/${motionId}/open`, {
      headers: hostAuth,
    });
    expect(opened.ok(), `open motion: HTTP ${opened.status()} ${await opened.text()}`).toBeTruthy();

    const prompt = page.getByRole("region", { name: "Mời bỏ phiếu" });
    await expect(prompt).toBeVisible({ timeout: 15_000 });
    await expect(prompt.getByText(title, { exact: true })).toBeVisible();
    await expect(votesTab).toBeVisible();
    await expect(page.getByLabel("Có nội dung đang chờ bạn bỏ phiếu")).toBeVisible();
    // The card announces itself; it never pulls focus out of the room.
    expect(await prompt.evaluate((el) => el.contains(document.activeElement))).toBe(false);
    const submit = prompt.getByRole("button", { name: "Gửi phiếu" });
    await expect(submit).toBeDisabled();
    await expect(prompt.getByText("Không thay đổi được sau khi gửi.")).toBeVisible();
    await prompt.getByRole("radio", { name: "Tán thành", exact: true }).click();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(prompt.getByText("Đã ghi nhận phiếu", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Mời bỏ phiếu" })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByLabel("Có nội dung đang chờ bạn bỏ phiếu")).toHaveCount(0);

    // The same person again (a second tab) is refused; the count stays one.
    const again = await castBallot(page, meeting.id, motionId, memberAuth, "NO");
    expect(again.status()).toBe(409);
    expect(await errorCode(again)).toBe("already_voted");
    const hostVote = await castBallot(page, meeting.id, motionId, hostAuth, "YES");
    expect(hostVote.ok(), `host ballot: HTTP ${hostVote.status()} ${await hostVote.text()}`).toBeTruthy();
    const closed = await page.request.post(`${API}/api/v1/meetings/${meeting.id}/motions/${motionId}/close`, {
      headers: hostAuth,
    });
    expect(closed.ok(), `close motion: HTTP ${closed.status()} ${await closed.text()}`).toBeTruthy();

    // Everyone in the room hears the result.
    await expect(page.getByText(`“${title}”: Thông qua`, { exact: true })).toBeVisible({ timeout: 15_000 });
    await votesTab.click();
    const panel = page.getByRole("tabpanel", { name: "Biểu quyết" });
    await expect(panel.getByText("Thông qua", { exact: true })).toBeVisible();
    await expect(panel.getByText("Bỏ phiếu kín — không hiện ai chọn gì.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Xem ai chọn gì" })).toHaveCount(0);

    // A secret ballot keeps no link between a person and a choice.
    const motion = await findMotion(page, meeting.id, memberAuth, title);
    expect(motion.voters).toBeNull();
    expect(motion.result).toEqual({ yes: 2, no: 0, abstain: 0, required: 2, outcome: "PASSED" });
    expect(motion.my_ballot).toEqual({ on_roll: true, cast: true, choice: null });
  });
});
