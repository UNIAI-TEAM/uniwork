import { expect, test } from "@playwright/test";
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

  const created = await page.request.post(`${api}/api/v1/meetings/${meeting.id}/summary/tasks`, {
    headers: auth, data: { items: [{ title: "Gửi báo giá e2e" }] },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { task_ids: [taskId] } = (await created.json()) as { task_ids: string[] };

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
  // The graph trails its sources by seconds: reload until the projection lands.
  await expect(async () => {
    await page.reload();
    await expect(related.getByText("Xuất phát từ")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(related.getByRole("link", { name: "Giao ban đồ thị" })).toBeVisible();

  const timeline = page.getByTestId("graph-history");
  await expect(timeline.getByText(/^Giao cho /)).toHaveCount(2);
});
