import { expect, test } from "@playwright/test";
import { seedMeetingSummary } from "./db";
import {
  createInstantMeeting,
  createRecordingAccount,
  joinWorkspaceAsMember,
  loginViaUi,
  registerApiUser,
} from "./meeting-recording-fixture";

test("a task made from a meeting shows where it came from and who owned it", async ({ page }) => {
  test.slow();
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  const host = await createRecordingAccount(page, api, "graph-host");
  const peer = await registerApiUser(page, api, "graph-peer");
  await joinWorkspaceAsMember(page, api, host.token, host.wsId, peer);
  const auth = { authorization: `Bearer ${host.token}`, "content-type": "application/json" };
  const meeting = await createInstantMeeting(page, api, host.token, host.wsId, "Giao ban đồ thị");

  // CI runs without an AI provider, so the summary the host would generate is
  // seeded with its action items; the task is then made the way the host
  // makes it, by converting the pending item.
  await seedMeetingSummary(meeting.id, [{ title: "Gửi báo giá e2e" }]);
  const listed = await page.request.get(`${api}/api/v1/meetings/${meeting.id}/action-items`, { headers: auth });
  expect(listed.ok(), await listed.text()).toBeTruthy();
  const { items: [item] } = (await listed.json()) as { items: { id: string }[] };
  const created = await page.request.post(`${api}/api/v1/meetings/${meeting.id}/action-items/convert`, {
    headers: auth, data: { items: [{ action_item_id: item!.id, assignee_id: null, due_date: null }] },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { links: [link] } = (await created.json()) as { links: { task_id: string }[] };
  const taskId = link!.task_id;

  const idOf = async (token: string) =>
    ((await (await page.request.get(`${api}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } })).json()) as { user: { id: string } }).user.id;
  const hostId = await idOf(host.token);
  const peerId = await idOf(peer.token);
  const history = `${api}/api/v1/workspaces/${host.wsId}/graph/nodes/TASK/${taskId}/history`;
  const ownedBy = async () =>
    ((await (await page.request.get(history, { headers: auth })).json()) as { items?: { edge_type?: string; node?: { id: string } }[] })
      .items?.filter((i) => i.edge_type === "OWNED_BY").map((i) => i.node?.id) ?? [];
  // Changes inside one projection window fold into the final state (spec §13 #10),
  // so wait for the first assignment to land before making the second.
  for (const [assignee, count] of [[hostId, 1], [peerId, 2]] as const) {
    const res = await page.request.patch(`${api}/api/v1/tasks/${taskId}`, { headers: auth, data: { assignee_id: assignee } });
    expect(res.ok(), await res.text()).toBeTruthy();
    await expect.poll(async () => (await ownedBy()).length, { timeout: 30_000 }).toBe(count);
  }

  await loginViaUi(page, host.email);
  await page.goto(`/${host.orgSlug}/${host.wsSlug}/tasks/${taskId}`);
  const related = page.getByTestId("graph-related");
  // A task made from a meeting names its source in the header line, and the
  // Related panel does not repeat it (the screen already shows the origin).
  await expect(page.getByRole("link", { name: /Từ cuộc họp\s*Giao ban đồ thị/ })).toBeVisible({ timeout: 30_000 });
  // The graph trails its sources by seconds: reload until the projection lands.
  // The owner is the neighbor that proves it did; the origin edge is projected
  // before it, so its absence below is not a race.
  await expect(async () => {
    await page.reload();
    await expect(related.getByText("Người phụ trách")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(related.getByText("Xuất phát từ")).toHaveCount(0);

  const timeline = page.getByTestId("graph-history");
  await expect(timeline.getByText(/^Giao cho /)).toHaveCount(2);
});
