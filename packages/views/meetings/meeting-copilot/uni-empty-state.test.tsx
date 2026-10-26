import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../../test/api-mock";
import { UniEmptyState } from "./uni-empty-state";

beforeAll(() => {
  initI18n();
});

const carried = (n: number) => ({
  items: Array.from({ length: n }, (_, i) => ({
    action_item_id: `ai${i}`,
    meeting: { id: "m0", title: "Họp tuần trước" },
    task: { id: `t${i}`, title: `Việc ${i}` },
  })),
  total: n,
});

describe("UniEmptyState", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("says the scribe is listening and hides the three sample rows from screen readers", async () => {
    requestMock.mockResolvedValue(carried(0));
    render(wrap(<UniEmptyState meetingId="m1" scribeState="on" onOpenCarried={() => {}} />));

    expect(screen.getByRole("heading", { name: "Thư ký UNI đang nghe" })).toBeInTheDocument();
    expect(screen.getByText("Ý chính sẽ hiện ở đây ngay khi có người nói.")).toBeInTheDocument();
    for (const label of ["Chốt", "Việc", "Hỏi"]) {
      expect(screen.getByText(label).closest("[aria-hidden='true']")).not.toBeNull();
    }
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/carried-over-items"));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the open items from earlier meetings and opens them on press", async () => {
    requestMock.mockResolvedValue(carried(3));
    const onOpenCarried = vi.fn();
    render(wrap(<UniEmptyState meetingId="m1" scribeState="on" onOpenCarried={onOpenCarried} />));

    const card = await screen.findByRole("button", { name: "3 việc còn mở, Từ lần họp trước" });
    expect(card).toHaveTextContent("3 việc còn mở");
    expect(card).toHaveTextContent("Từ lần họp trước");
    fireEvent.click(card);
    expect(onOpenCarried).toHaveBeenCalledTimes(1);
  });

  it("says there is no transcript when the scribe is off", () => {
    requestMock.mockResolvedValue(carried(0));
    render(wrap(<UniEmptyState meetingId="m1" scribeState="off" onOpenCarried={() => {}} />));

    expect(
      screen.getByRole("heading", { name: "Chưa có bản ghi lời thoại. Bật phụ đề trong phòng họp để ghi lại." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Thư ký UNI đang nghe" })).toBeNull();
    expect(screen.getByText("Ý chính sẽ hiện ở đây ngay khi có người nói.")).toBeInTheDocument();
  });
});
