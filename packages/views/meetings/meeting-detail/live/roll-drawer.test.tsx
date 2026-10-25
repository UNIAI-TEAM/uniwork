import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../../test/api-mock";
import { DetailContext } from "../detail-context";
import { demo, demoUser, demoWorkspace, detailValue, fixtureMeeting, routeMeeting, type DemoUserKey } from "../test-fixtures";
import { RollDrawer } from "./roll-drawer";

const M4 = fixtureMeeting("m4");
const ROLL = demo.meetings.m4.attendance;

function renderDrawer(who: DemoUserKey, attendance: unknown = ROLL) {
  routeMeeting("m4", { viewer: who, extra: { [`/api/v1/meetings/${M4.id}/attendance`]: attendance } });
  setSessionUser(demoUser(who));
  const onOpenChange = vi.fn();
  const { unmount } = render(
    wrapWithNav(
      <WorkspaceProvider workspace={demoWorkspace} user={demoUser(who)}>
        <DetailContext.Provider value={detailValue("m4", { user: who })}>
          <div data-testid="meeting-detail-content">
            <RollDrawer open onOpenChange={onOpenChange} />
          </div>
        </DetailContext.Provider>
      </WorkspaceProvider>,
    ),
  );
  return { onOpenChange, unmount };
}

const posted = (suffix: string) =>
  requestMock.mock.calls.find(([path, opts]) => String(path).endsWith(suffix) && (opts as { method?: string })?.method);

beforeEach(() => {
  requestMock.mockReset();
});

describe("RollDrawer", () => {
  it("groups the roll by status with counts, duties and the excuse, in a 480 drawer", async () => {
    const { onOpenChange } = renderDrawer("ha");
    const drawer = await screen.findByRole("dialog", { name: "Điểm danh · 5 người" });
    expect(drawer).toHaveClass("data-[side=right]:w-120");
    expect(within(drawer).getByText("Chưa ai vào phòng trực tuyến")).toBeInTheDocument();

    const present = within(drawer).getByRole("region", { name: "Có mặt" });
    expect(within(present).getByText("3")).toBeInTheDocument();
    expect(within(present).getByText("Chủ trì")).toBeInTheDocument();
    expect(within(present).getByText("Thư ký · bạn")).toBeInTheDocument();
    expect(within(drawer).getByRole("region", { name: "Muộn" })).toHaveTextContent("Tuấn Đỗ");
    expect(within(drawer).getByRole("region", { name: "Vắng có phép" })).toHaveTextContent("Đang gặp khách ở Đà Nẵng");
    expect(within(drawer).queryByRole("region", { name: "Vắng" })).toBeNull();
    expect(within(drawer).queryByRole("searchbox")).toBeNull();

    expect(within(drawer).getByText("Biểu quyết tính trên 4 người: 3 có mặt, 1 muộn")).toBeInTheDocument();
    expect(within(drawer).getByRole("combobox", { name: "Trạng thái của Tuấn Đỗ" })).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: "Đóng" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("finalizes the roll after a confirmation", async () => {
    renderDrawer("ha");
    fireEvent.click(await screen.findByRole("button", { name: "Chốt điểm danh" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Chốt điểm danh?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Chốt điểm danh" }));
    await waitFor(() => expect(posted("/attendance/finalize")).toBeDefined());
  });

  it("reads a member the roll without selects or the finalize button", async () => {
    renderDrawer("minh");
    const drawer = await screen.findByRole("dialog", { name: "Điểm danh · 5 người" });
    expect(within(drawer).queryByRole("combobox")).toBeNull();
    expect(within(drawer).queryByRole("button", { name: "Chốt điểm danh" })).toBeNull();
    expect(within(within(drawer).getByRole("region", { name: "Muộn" })).getAllByText("Muộn")).toHaveLength(2);
  });

  it("asks for the reason after an excuse and saves it with the mark", async () => {
    const rows = ROLL.rows.map((r) => (r.display_name === "Tuấn Đỗ" ? { ...r, status: "EXCUSED", note: "" } : r));
    renderDrawer("ha", { ...ROLL, rows });
    fireEvent.click(await screen.findByRole("button", { name: "Thêm lý do" }));
    const field = screen.getByRole("textbox", { name: "Lý do vắng của Tuấn Đỗ" });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "Ốm" } });
    fireEvent.blur(field);
    const tuan = `/attendance/${ROLL.rows.find((r) => r.display_name === "Tuấn Đỗ")!.participant_id}`;
    await waitFor(() => expect(posted(tuan)).toBeDefined());
    expect((posted(tuan)![1] as { body?: unknown }).body).toEqual({ status: "EXCUSED", note: "Ốm" });
  });

  it("searches a roll of more than eight people", async () => {
    const extra = Array.from({ length: 5 }, (_, i) => ({ ...ROLL.rows[2]!, participant_id: `px${i}`, user_id: undefined, display_name: `Khách ${i}` }));
    renderDrawer("ha", { ...ROLL, rows: [...ROLL.rows, ...extra] });
    const search = await screen.findByRole("searchbox", { name: "Tìm người trong điểm danh" });
    fireEvent.change(search, { target: { value: "bảo" } });
    expect(screen.getByText("Bảo Nguyễn")).toBeInTheDocument();
    expect(screen.queryByText("Lan Phạm")).toBeNull();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("Không có ai khớp")).toBeInTheDocument();
  });

  it("docks beside the page on a wide window: no scrim, and a click on the page keeps it open", async () => {
    const width = window.innerWidth;
    window.innerWidth = 1440;
    try {
      const { onOpenChange, unmount } = renderDrawer("ha");
      const drawer = await screen.findByRole("dialog", { name: "Điểm danh · 5 người" });
      expect(drawer).toHaveClass("shadow-menu");
      const content = screen.getByTestId("meeting-detail-content");
      expect(content).toHaveAttribute("data-panel", "roll");
      expect(document.querySelector("[data-slot='sheet-overlay']")).toHaveClass("hidden");
      fireEvent.pointerDown(document.body);
      fireEvent.click(document.body);
      expect(onOpenChange).not.toHaveBeenCalled();
      unmount();
      expect(content).not.toHaveAttribute("data-panel");
    } finally {
      window.innerWidth = width;
    }
  });
});
