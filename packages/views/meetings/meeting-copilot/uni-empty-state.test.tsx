import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { meetingKeys } from "@uniwork/core/meetings";
import { requestMock, wrap } from "../../test/api-mock";
import { UniEmptyState } from "./uni-empty-state";

beforeAll(() => {
  initI18n();
});

const carried = (n: number, assignees: (string | null)[] = []) => ({
  items: Array.from({ length: n }, (_, i) => ({
    action_item_id: `ai${i}`,
    meeting: { id: "m0", title: "Họp tuần trước" },
    task: { id: `t${i}`, title: `Việc ${i}`, assignee_id: assignees[i] ?? null },
  })),
  total: n,
});

const member = (user_id: string, display_name: string) => ({
  workspace_id: "w1",
  user_id,
  role: "member",
  email: `${user_id}@x.com`,
  display_name,
});

// The carried-over items for the meeting, and the workspace members the faces are named from.
function serve(items: ReturnType<typeof carried>) {
  requestMock.mockImplementation((path: unknown) =>
    Promise.resolve(
      String(path).endsWith("/members")
        ? { members: [member("u-mai", "Mai Anh"), member("u-hung", "Hùng Võ"), member("u-lan", "Lan Trần")] }
        : items,
    ),
  );
}

// The outer wrapper of each face; the kit avatar inside carries the same slot.
const faces = (card: HTMLElement) => card.querySelectorAll("[data-slot='avatar']:not([data-slot='avatar'] *)");

describe("UniEmptyState", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("says the scribe is listening and hides the three sample rows from screen readers", async () => {
    serve(carried(0));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(wrap(<UniEmptyState meetingId="m1" workspaceId="w1" scribeState="on" onOpenCarried={() => {}} />, client));

    expect(screen.getByRole("heading", { name: "Thư ký UNI đang nghe" })).toBeInTheDocument();
    expect(screen.getByText("Ý chính sẽ hiện ở đây ngay khi có người nói.")).toBeInTheDocument();
    for (const label of ["Chốt", "Việc", "Hỏi"]) {
      expect(screen.getByText(label).closest("[aria-hidden='true']")).not.toBeNull();
    }
    // Let the carried-over answer land, so "no card" is not just "not loaded yet".
    await vi.waitFor(() => expect(client.getQueryState(meetingKeys.carriedOver("m1"))?.status).toBe("success"));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the open items from earlier meetings and opens them on press", async () => {
    serve(carried(3));
    const onOpenCarried = vi.fn();
    render(wrap(<UniEmptyState meetingId="m1" workspaceId="w1" scribeState="on" onOpenCarried={onOpenCarried} />));

    const card = await screen.findByRole("button", { name: "3 việc còn mở, Từ lần họp trước" });
    expect(card).toHaveTextContent("3 việc còn mở");
    expect(card).toHaveTextContent("Từ lần họp trước");
    fireEvent.click(card);
    expect(onOpenCarried).toHaveBeenCalledTimes(1);
    // Nobody is assigned, so no faces.
    expect(faces(card)).toHaveLength(0);
  });

  it("shows up to two faces of the people the open items wait on, each once", async () => {
    serve(carried(4, ["u-mai", "u-mai", null, "u-hung"]));
    render(wrap(<UniEmptyState meetingId="m1" workspaceId="w1" scribeState="on" onOpenCarried={() => {}} />));

    const card = await screen.findByRole("button", { name: "4 việc còn mở, Từ lần họp trước" });
    await vi.waitFor(() => expect(faces(card)).toHaveLength(2));
    expect([...faces(card)].map((face) => face.textContent)).toEqual(["MA", "HV"]);
    expect([...faces(card)].every((face) => face.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("says there is no transcript when the scribe is off", () => {
    serve(carried(0));
    render(wrap(<UniEmptyState meetingId="m1" workspaceId="w1" scribeState="off" onOpenCarried={() => {}} />));

    expect(
      screen.getByRole("heading", { name: "Chưa có bản ghi lời thoại. Bật phụ đề trong phòng họp để ghi lại." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Thư ký UNI đang nghe" })).toBeNull();
    expect(screen.getByText("Ý chính sẽ hiện ở đây ngay khi có người nói.")).toBeInTheDocument();
  });
});
