import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../../test/api-mock";
import { DetailContext, type DetailContextValue } from "../detail-context";
import { DEMO_NOW, demoUser, demoWorkspace, detailValue, fixtureMeeting, routeMeeting, type DemoUserKey } from "../test-fixtures";
import { StripLiveRows } from "./strip-live-rows";

const M4 = fixtureMeeting("m4");
const BASE = `/api/v1/meetings/${M4.id}`;
const OPEN_ID = "01M5MHXMTER3T3FBKJNGG32T58";

function renderRows(
  who: DemoUserKey,
  { ballot, value, ui = <StripLiveRows /> }: { ballot?: unknown; value?: Partial<DetailContextValue>; ui?: ReactElement } = {},
) {
  routeMeeting("m4", { viewer: who, extra: { [`${BASE}/my-ballots`]: { ballots: ballot ? [ballot] : [] } } });
  setSessionUser(demoUser(who));
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={demoWorkspace} user={demoUser(who)}>
        <DetailContext.Provider value={detailValue("m4", { user: who, ...value })}>{ui}</DetailContext.Provider>
      </WorkspaceProvider>,
    ),
  );
}

const posted = (suffix: string) =>
  requestMock.mock.calls.some(([path, opts]) => String(path).endsWith(suffix) && (opts as { method?: string })?.method === "POST");

beforeEach(() => {
  requestMock.mockReset();
});

describe("StripLiveRows", () => {
  it("shows the host the guest at the door, the open vote with what they chose, and the draft", async () => {
    renderRows("lan", { ballot: { motion_id: OPEN_ID, cast: true, choice: "YES" } });

    expect(await screen.findByText("Trịnh Văn Long xin vào phòng")).toBeInTheDocument();
    expect(screen.getByText("Khách bên ngoài")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cho Trịnh Văn Long vào phòng" })).toBeInTheDocument();

    const vote = screen.getByRole("region", { name: "Bật chế độ đối soát chậm cho thanh toán QR trên toàn hệ thống" });
    expect(within(vote).getByRole("img", { name: "2 trên 4 người đã bỏ phiếu" }).querySelectorAll(".bg-primary")).toHaveLength(2);
    expect(within(vote).getByText("2/4 đã bỏ phiếu · quá bán · trên số có mặt · công khai")).toBeInTheDocument();
    expect(await within(vote).findByText("Bạn đã chọn: Tán thành")).toBeInTheDocument();
    expect(within(vote).getByRole("button", { name: "Đóng biểu quyết" })).toBeInTheDocument();

    // Two twins (desktop / phone), one hidden by a container query; jsdom draws both.
    const [phoneTwin, open] = screen.getAllByRole("button", {
      name: "Mở biểu quyết: Hoàn tiền ngay cho khách bị trừ hai lần, không chờ đối soát cuối ngày",
    });
    expect(open).toHaveAttribute("aria-disabled", "true");
    expect(phoneTwin).toHaveClass("hidden");
    expect(screen.getByText("Cần 2/3 số có mặt · công khai · mở được sau khi biểu quyết đang mở kết thúc")).toBeInTheDocument();
    fireEvent.click(open!);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("lets the host admit or decline the guest", async () => {
    renderRows("lan");
    fireEvent.click(await screen.findByRole("button", { name: "Cho Trịnh Văn Long vào phòng" }));
    await waitFor(() => expect(posted("/approve")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Từ chối Trịnh Văn Long" }));
    await waitFor(() => expect(posted("/reject")).toBe(true));
  });

  it("past the end, asks the host to extend before letting the guest in", async () => {
    renderRows("lan", { value: { displayStatus: "OVERTIME", now: DEMO_NOW + 60 * 60_000 } });
    expect(await screen.findByText("Gia hạn để cho vào")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cho Trịnh Văn Long vào phòng" })).toBeNull();
    expect(screen.getByRole("button", { name: "Từ chối Trịnh Văn Long" })).toBeInTheDocument();
  });

  it("never mounts the lobby for the secretary, and gives her the ballot in two steps", async () => {
    renderRows("ha", { ballot: { motion_id: OPEN_ID, cast: false } });

    const ballot = await screen.findByRole("group", { name: "Phiếu của bạn, bạn chưa bỏ phiếu" });
    expect(screen.queryByText("Trịnh Văn Long xin vào phòng")).toBeNull();
    expect(requestMock.mock.calls.some(([p]) => String(p).endsWith("/join-requests"))).toBe(false);
    // The ballot is her one job: no close button until she has voted.
    expect(screen.queryByRole("button", { name: "Đóng biểu quyết" })).toBeNull();

    fireEvent.click(within(ballot).getByRole("radio", { name: "Phản đối" }));
    expect(posted("/ballot")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Gửi phiếu" }));
    await waitFor(() => expect(posted(`/motions/${OPEN_ID}/ballot`)).toBe(true));
    const call = requestMock.mock.calls.find(([p]) => String(p).endsWith("/ballot"));
    expect((call?.[1] as { body?: unknown }).body).toEqual({ choice: "NO" });
  });

  it("gives the secretary the draft as a job row with an inactive outline button while a vote is open", async () => {
    renderRows("ha", { ballot: { motion_id: OPEN_ID, cast: false } });
    const open = await screen.findByRole("button", {
      name: "Mở biểu quyết: Hoàn tiền ngay cho khách bị trừ hai lần, không chờ đối soát cuối ngày",
    });
    expect(open).toHaveAttribute("aria-disabled", "true");
    expect(open.closest("div")).toHaveTextContent("Bản nháp biểu quyết: Hoàn tiền ngay cho khách bị trừ hai lần, không chờ đối soát cuối ngày");
    expect(screen.getByText("Hoàn tiền ngay cho khách bị trừ hai lần, không chờ đối soát cuối ngày").tagName).toBe("STRONG");
    expect(screen.queryByText("Nháp")).toBeNull();
    fireEvent.click(open);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lets a clerk close the vote after a confirmation that counts the missing ballots", async () => {
    renderRows("lan", { ballot: { motion_id: OPEN_ID, cast: true, choice: "YES" } });
    fireEvent.click(await screen.findByRole("button", { name: "Đóng biểu quyết" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Đóng biểu quyết?" });
    expect(within(dialog).getByText(/Còn 2 người chưa bỏ phiếu/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Đóng biểu quyết" }));
    await waitFor(() => expect(posted(`/motions/${OPEN_ID}/close`)).toBe(true));
  });

  it("shows a member neither the lobby nor drafts, only the vote", async () => {
    renderRows("minh", { ballot: { motion_id: OPEN_ID, cast: true, choice: "ABSTAIN" } });
    expect(await screen.findByText("Bạn đã chọn: Không ý kiến")).toBeInTheDocument();
    expect(screen.queryByText("Nháp")).toBeNull();
    expect(screen.queryByRole("button", { name: "Đóng biểu quyết" })).toBeNull();
    expect(screen.queryByText("Trịnh Văn Long xin vào phòng")).toBeNull();
  });

  it("before the meeting, lists a clerk's drafts as not openable yet", async () => {
    renderRows("lan", { value: { displayStatus: "SCHEDULED" } });
    expect(await screen.findByText("Cần 2/3 số có mặt · công khai · mở được khi cuộc họp bắt đầu")).toBeInTheDocument();
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByText("Trịnh Văn Long xin vào phòng")).toBeNull();
  });

  it("draws nothing once the meeting is over", () => {
    const { container } = renderRows("lan", { value: { displayStatus: "ENDED" } });
    expect(container).toBeEmptyDOMElement();
  });
});
