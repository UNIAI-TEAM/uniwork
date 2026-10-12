import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestMock, wrap } from "../test/api-mock";
import { CalendarConnectionsDialog } from "./calendar-connections-dialog";

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) =>
    path === "/api/v1/workspaces/ws1/calendar/connections" ? Promise.resolve({ connections: [] }) : Promise.resolve({}),
  );
});

afterEach(() => vi.restoreAllMocks());

describe("CalendarConnectionsDialog", () => {
  it("says the browser blocked the sign-in window, not that the connection failed", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(wrap(<CalendarConnectionsDialog workspaceId="ws1" />));
    fireEvent.click(screen.getByRole("button", { name: "Lịch đã kết nối" }));
    fireEvent.click(await screen.findByRole("button", { name: /Thêm lịch/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Google Calendar/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Trình duyệt đã chặn cửa sổ đăng nhập lịch. Cho phép cửa sổ bật lên (pop-up) với UniWork rồi thử lại.",
    );
    expect(screen.queryByText("Không thể cập nhật kết nối lịch. Vui lòng thử lại.")).toBeNull();
  });
});
