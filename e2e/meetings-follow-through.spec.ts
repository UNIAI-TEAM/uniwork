import { expect, test, type APIRequestContext } from "@playwright/test";
import { VI_LOCALE_STATE } from "./locale-state";
import {
  createInstantMeeting,
  createRecordingAccount,
  endMeeting,
  joinWorkspaceAsMember,
  loginViaUi,
  registerApiUser,
} from "./meeting-recording-fixture";

// The program spec of "after the meeting" (UNI-1995, spec meeting
// follow-through §13.3): end a meeting that has notes → summarise → assign
// two items, dismiss one, add one through the task composer → the assignee gets
// one notification and the task says which meeting it came from → regenerate
// the summary, the handled items stay → the next meeting of the project
// shows the tasks still open.
//
// Requires the server with AI_PROVIDER=fake: the fake answers a meeting
// summary with one action item per "Việc: …" line of the notes. Without a
// provider the summary command answers 503 and the spec skips itself, except
// in CI, whose e2e job sets AI_PROVIDER=fake: there a missing or different
// provider fails, so the flow cannot be silently switched off again.
const stamp = Date.now();
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const inCI = Boolean(process.env.CI);

function headers(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function ok<T>(res: Awaited<ReturnType<APIRequestContext["get"]>>, what: string): Promise<T> {
  expect(res.ok(), `${what}: HTTP ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

test("a meeting's items become tasks, survive a new summary and carry over to the next meeting", async ({ page, browser }) => {
  test.slow();
  // A real model would not answer with the items the notes list.
  const provider = process.env.AI_PROVIDER;
  test.skip(Boolean(provider) && provider !== "fake", `needs AI_PROVIDER=fake, this run has ${provider}`);
  const host = await createRecordingAccount(page, api, "ft-host");
  const peer = await registerApiUser(page, api, "ft-peer");
  await joinWorkspaceAsMember(page, api, host.token, host.wsId, peer);
  const auth = headers(host.token);
  const { user: peerUser } = await ok<{ user: { id: string } }>(
    await page.request.get(`${api}/api/v1/me`, { headers: headers(peer.token) }),
    "me (peer)",
  );

  const { project } = await ok<{ project: { id: string } }>(
    await page.request.post(`${api}/api/v1/workspaces/${host.wsId}/projects`, { headers: auth, data: { title: `Ra mắt ${stamp}` } }),
    "create project",
  );
  const title = `Giao ban ${stamp}`;
  const first = await createInstantMeeting(page, api, host.token, host.wsId, title);
  await ok(await page.request.patch(`${api}/api/v1/meetings/${first.id}`, { headers: auth, data: { project_id: project.id } }), "set project");
  // Under AI_PROVIDER=fake a note line "Việc: <title> | <owner>" is an
  // action item of the summary (internal/ai/fake.go).
  const notes = ["Việc: Gửi báo giá | ft-peer", "Việc: Đặt phòng hội thảo | ft-peer", "Việc: In tài liệu", "Việc: Gọi nhà cung cấp"];
  await ok(
    await page.request.post(`${api}/api/v1/meetings/${first.id}/notes`, { headers: auth, data: { body: notes.join("\n") } }),
    "add note",
  );
  await endMeeting(page, api, host.token, first.id);

  const summarize = () => page.request.post(`${api}/api/v1/meetings/${first.id}/summary`, { headers: auth, data: { locale: "vi" } });
  // POST answers 202 with the run running (UNI-1995 #12); the items are
  // stored when it ends. The lease is taken before the 202, so a run that
  // is no longer "running" has ended (an auto run may still be "queued").
  const summaryRunEnded = async (what: string) => {
    let failure: unknown = null;
    await expect
      .poll(
        async () => {
          const view = await ok<{ run: { status: string; failure: unknown } }>(
            await page.request.get(`${api}/api/v1/meetings/${first.id}/summary`, { headers: auth }),
            `${what}: summary run`,
          );
          failure = view.run.failure;
          return view.run.status;
        },
        { message: `${what}: the summary run ends`, timeout: 60_000 },
      )
      .not.toBe("running");
    expect(failure, `${what}: the summary run failed`).toBeNull();
  };
  const summarized = await summarize();
  expect(summarized.status() === 503 && inCI, "CI runs AI_PROVIDER=fake: the summary must not answer 503").toBe(false);
  test.skip(summarized.status() === 503, "AI provider not configured on this server (AI_PROVIDER=fake)");
  await ok(summarized, "summarize");
  await summaryRunEnded("summarize");
  // Another provider on the server answers without the notes' items.
  const firstItems = await ok<{ items: unknown[] }>(
    await page.request.get(`${api}/api/v1/meetings/${first.id}/action-items`, { headers: auth }),
    "list items after the summary",
  );
  if (inCI) expect(firstItems.items.length, "CI runs AI_PROVIDER=fake: one item per note line").toBe(notes.length);
  test.skip(firstItems.items.length !== notes.length, "the server's AI provider is not the fake one (AI_PROVIDER=fake)");

  // Host: assign two items at once on the meeting's suggestions (the owner
  // phrase names the peer), dismiss one with a reason, add one the summary
  // missed through the task composer.
  await loginViaUi(page, host.email);
  const meetingURL = `/${host.orgSlug}/${host.wsSlug}/meetings/${first.id}`;
  await page.goto(meetingURL);
  const section = page.getByRole("region", { name: "Việc cần làm", exact: true });
  // Select → review sheet → "Giao n việc" (ADR 0010: the AI proposes, the clerk confirms).
  await section.getByRole("checkbox", { name: "Gửi báo giá" }).check({ timeout: 20_000 });
  await section.getByRole("checkbox", { name: "Đặt phòng hội thảo" }).check();
  await page.getByRole("region", { name: "Việc đã chọn" }).getByRole("button", { name: "Xem lại và giao" }).click();
  const review = page.getByRole("dialog", { name: /^Giao 2 việc/ });
  const assign = review.getByRole("button", { name: "Giao 2 việc" });
  await expect(assign).not.toHaveAttribute("aria-busy", "true");
  await assign.click();
  await expect(review).toBeHidden({ timeout: 15_000 });
  await expect(section.getByText("2 chờ giao · 2 đã giao")).toBeVisible({ timeout: 15_000 });

  const printRow = section.getByRole("listitem").filter({ hasText: "In tài liệu" });
  await printRow.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Lý do (không bắt buộc)").fill("Đã có bản in");
  await page.getByRole("button", { name: "Bỏ qua việc" }).click();
  await expect(section.getByRole("button", { name: "Đã bỏ qua 1" })).toBeVisible();

  await section.getByRole("button", { name: "Thêm việc" }).click();
  const composer = page.getByRole("dialog", { name: /Task sau họp/ });
  await composer.getByRole("textbox", { name: "Tiêu đề issue" }).fill("Chốt ngân sách");
  await composer.getByRole("button", { name: /^Tạo/ }).click();
  await expect(composer).toBeHidden({ timeout: 15_000 });
  await expect(section.getByText("1 chờ giao · 3 đã giao")).toBeVisible();

  const { items } = await ok<{ items: { title: string; status: string; task?: { id: string; assignee_id?: string } }[] }>(
    await page.request.get(`${api}/api/v1/meetings/${first.id}/action-items`, { headers: auth }),
    "list items",
  );
  const assigned = items.filter((i) => i.status === "CONVERTED");
  expect(assigned.map((i) => i.title).sort()).toEqual(["Chốt ngân sách", "Gửi báo giá", "Đặt phòng hội thảo"]);
  expect(assigned.filter((i) => i.title !== "Chốt ngân sách").every((i) => i.task?.assignee_id === peerUser.id)).toBeTruthy();
  const taskId = assigned.find((i) => i.title === "Gửi báo giá")!.task!.id;

  // Peer: one notification for the two tasks (one convert), and the task names its meeting.
  const peerContext = await browser.newContext({ locale: "vi-VN", storageState: VI_LOCALE_STATE });
  const peerPage = await peerContext.newPage();
  await loginViaUi(peerPage, peer.email);
  await peerPage.goto(`/${host.orgSlug}/${host.wsSlug}/inbox`);
  await expect(peerPage.getByRole("link", { name: /ft-host đã giao bạn 2 việc/ })).toBeVisible({ timeout: 20_000 });
  await peerPage.goto(`/${host.orgSlug}/${host.wsSlug}/tasks/${taskId}`);
  await expect(peerPage.getByRole("link", { name: new RegExp(`^Từ cuộc họp ${title} · `) })).toBeVisible({ timeout: 20_000 });
  await peerContext.close();

  // Host: a new summary replaces only what nobody handled.
  await ok(await summarize(), "summarize again");
  await summaryRunEnded("summarize again");
  await page.reload();
  await expect(section.getByText("1 chờ giao · 3 đã giao")).toBeVisible({ timeout: 20_000 });
  await expect(section.getByRole("button", { name: "Đã bỏ qua 1" })).toBeVisible();
  // Assigned rows fold per owner; none of them came back as a pending row.
  await expect(section.getByRole("checkbox", { name: "Gửi báo giá" })).toHaveCount(0);

  // The next meeting of the project shows the two open tasks.
  const startsAt = Date.now() + 60 * 60_000;
  const { meeting: next } = await ok<{ meeting: { id: string } }>(
    await page.request.post(`${api}/api/v1/workspaces/${host.wsId}/meetings`, {
      headers: auth,
      data: {
        title: `Giao ban tiếp ${stamp}`,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(startsAt + 30 * 60_000).toISOString(),
        timezone: "Asia/Ho_Chi_Minh",
        project_id: project.id,
      },
    }),
    "create next meeting",
  );
  await page.goto(`/${host.orgSlug}/${host.wsSlug}/meetings/${next.id}`);
  // The host sees it folded to one line ("Việc còn tồn 3 …"); it opens in place.
  await page.getByRole("button", { name: /^Việc còn tồn/ }).click({ timeout: 20_000 });
  const carried = page.getByRole("list", { name: "Việc còn tồn" });
  await expect(carried.getByRole("link", { name: "Gửi báo giá" })).toBeVisible();
  await expect(carried.getByRole("link", { name: "Đặt phòng hội thảo" })).toBeVisible();
  await expect(carried.getByText("In tài liệu")).toHaveCount(0);
  await expect(page.getByRole("link", { name: `từ ${title}` })).toBeVisible();
});
