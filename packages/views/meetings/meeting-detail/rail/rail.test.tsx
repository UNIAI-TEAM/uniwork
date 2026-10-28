import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { setSessionUser } from "@uniwork/core/auth";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../../test/api-mock";
import { DetailContext, type DetailContextValue } from "../detail-context";
import { demo, demoUser, demoWorkspace, detailValue, fixtureMeeting, routeMeeting, type DemoUserKey, type MeetingFixtureKey } from "../test-fixtures";
import { DetailRail } from "./detail-rail";
import { PhonePeopleRow } from "./phone-rail";

const project = {
  id: demo.project.id,
  organization_id: demo.org.id,
  workspace_id: demo.workspace.id,
  title: demo.project.title,
  description: "",
  status: "active",
  priority: "none",
  revision: 1,
  task_count: 0,
  done_count: 0,
  resource_count: 0,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};
const ws = `/api/v1/workspaces/${demo.workspace.id}`;

function renderRail(
  key: MeetingFixtureKey,
  {
    viewer,
    value,
    extra = {},
    ui = <DetailRail />,
  }: { viewer?: DemoUserKey; value?: Partial<DetailContextValue>; extra?: Record<string, unknown>; ui?: ReactElement } = {},
) {
  const who = viewer ?? (key === "m1Outsider" ? "tuan" : "lan");
  routeMeeting(key, {
    viewer: who,
    extra: {
      [`${ws}/projects/${demo.project.id}`]: { project },
      [`${ws}/ai/capabilities`]: { enabled: true, ask_uni: true },
      [`${ws}/meeting-capabilities`]: { scribe: true, scribe_policy: "opt_in" },
      ...extra,
    },
  });
  setSessionUser(demoUser(who));
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={demoWorkspace} user={demoUser(who)}>
        <DetailContext.Provider value={detailValue(key, { user: who, ...value })}>{ui}</DetailContext.Provider>
      </WorkspaceProvider>,
    ),
  );
}

const rail = () => screen.getByRole("complementary", { name: "Thông tin cuộc họp" });
const called = (suffix: string) => requestMock.mock.calls.some(([p]) => String(p).split("?")[0]!.endsWith(suffix));

beforeEach(() => {
  requestMock.mockReset();
});

describe("DetailRail rows", () => {
  it("draws the ended host's rail (Main): people, project, AI, minutes, history and Ask", async () => {
    renderRail("m1");
    expect(await within(rail()).findByRole("button", { name: "Người dự: 3/3 có mặt; xem điểm danh" })).toBeInTheDocument();
    expect(rail()).toHaveTextContent(/Chủ trìLPLan Phạm/);
    expect(rail()).toHaveTextContent(/Thư kýHVHà Vũ/);
    expect(await within(rail()).findByRole("link", { name: "Ra mắt sản phẩm Q4" })).toBeInTheDocument();
    expect(
      await within(rail()).findByRole("button", { name: "Thư ký UNI: bật, nội dung AI chỉ người dự họp xem, đổi" }),
    ).toBeInTheDocument();
    expect(await within(rail()).findByRole("button", { name: "Biên bản: Bản nháp. Mở biên bản" })).toBeInTheDocument();
    expect(within(rail()).getByRole("button", { name: "Lịch sử thao tác" })).toBeInTheDocument();
    expect(await within(rail()).findByPlaceholderText("Hỏi về Giao ban tuần 43…")).toBeInTheDocument();
  });

  it("gives a member read-only AI and minutes rows (AfterMember)", async () => {
    renderRail("m1", { viewer: "minh" });
    expect(await within(rail()).findByText("Thư ký đang hoàn thiện")).toBeInTheDocument();
    expect(within(rail()).queryByRole("button", { name: /Thư ký UNI/ })).not.toBeInTheDocument();
    expect(within(rail()).getByText("Bật · chỉ người dự họp")).toBeInTheDocument();
    expect(within(rail()).getByRole("button", { name: "Lịch sử thao tác" })).toBeInTheDocument();
  });

  it("shows a scheduled member the RSVP tally, and never asks for the guest links (ScheduledMember)", async () => {
    renderRail("m3", { viewer: "minh" });
    expect(await within(rail()).findByText("1 nhận lời")).toHaveAttribute("data-rsvp", "yes");
    expect(within(rail()).getByText("1 chưa phản hồi")).toHaveAttribute("data-rsvp", "wait");
    expect(within(rail()).getByText("3 người")).toBeInTheDocument();
    expect(within(rail()).queryByText("Thư ký")).not.toBeInTheDocument();
    expect(within(rail()).getByRole("button", { name: "Lịch sử thao tác" })).toBeInTheDocument();
    expect(within(rail()).queryByRole("textbox")).not.toBeInTheDocument();
    await waitFor(() => expect(called("/participants")).toBe(true));
    expect(called("/invite-links")).toBe(false);
    expect(within(rail()).queryByText("Khách")).not.toBeInTheDocument();
  });

  it("gives the scheduled host the guest-link row, which scrolls to the links (ScheduledHost)", async () => {
    const target = document.createElement("section");
    target.id = "khach";
    target.scrollIntoView = vi.fn();
    document.body.append(target);
    renderRail("m3");
    fireEvent.click(await within(rail()).findByRole("button", { name: "Khách: 1 liên kết. Xem liên kết" }));
    expect(target.scrollIntoView).toHaveBeenCalled();
    target.remove();
    expect(within(rail()).getByRole("button", { name: "Lịch sử thao tác" })).toBeInTheDocument();
  });

  it("lists Hình thức first for an in-person meeting", async () => {
    const { unmount } = renderRail("m3", { value: { meeting: { ...fixtureMeeting("m3"), venue: "in_person" } } });
    await within(rail()).findByRole("button", { name: "Lịch sử thao tác" });
    expect(rail().textContent).toMatch(/^Hình thứcTrực tiếpChủ trìLPLan Phạm/);
    unmount();
    renderRail("m3");
    expect(within(rail()).queryByText("Hình thức")).not.toBeInTheDocument();
  });

  it("draws the live host's roll, invitations and guests, and no project (LiveHost)", async () => {
    renderRail("m4");
    expect(
      await within(rail()).findByRole("button", {
        name: "Điểm danh: 3 có mặt, 1 muộn, 1 vắng có phép; Chưa ai vào phòng trực tuyến. Mở điểm danh",
      }),
    ).toBeInTheDocument();
    expect(await within(rail()).findByRole("button", { name: "Lời mời: 3 nhận lời · 1 từ chối. Xem và thêm người" })).toBeInTheDocument();
    expect(await within(rail()).findByRole("button", { name: /^Khách: 1 liên kết · cần duyệt · 0\/3 lượt, Đối tác ví MoMoPay · hết hạn CN 25\/10/ })).toBeInTheDocument();
    expect(await within(rail()).findByText("Đang nghe · 15 câu")).toBeInTheDocument();
    expect(within(rail()).queryByText("Dự án")).not.toBeInTheDocument();
    expect(within(rail()).getByRole("button", { name: "Lịch sử thao tác" })).toBeInTheDocument();
    expect(await within(rail()).findByRole("button", { name: "Tóm tắt từ đầu đến giờ" })).toBeInTheDocument();
  });

  it("marks the secretary's own row and keeps the guest links from them (LiveSecretary)", async () => {
    renderRail("m4", { viewer: "ha" });
    expect(await within(rail()).findByText(/Hà Vũ · bạn/)).toBeInTheDocument();
    await within(rail()).findByRole("button", { name: /^Điểm danh:/ });
    expect(called("/invite-links")).toBe(false);
  });

  it("keeps a canceled meeting's rail to the host, the project and the history (Canceled)", async () => {
    renderRail("m5");
    expect(await within(rail()).findByRole("link", { name: "Ra mắt sản phẩm Q4" })).toBeInTheDocument();
    expect(within(rail()).queryByText("Người dự")).not.toBeInTheDocument();
    expect(within(rail()).queryByText("Thư ký UNI")).not.toBeInTheDocument();
    expect(within(rail()).getByRole("button", { name: "Lịch sử thao tác" })).toBeInTheDocument();
  });

  it("shows an outsider the plain facts, and no Ask or history (AfterOutsider)", async () => {
    renderRail("m1Outsider");
    expect(await within(rail()).findByText("Chưa chốt")).toBeInTheDocument();
    expect(within(rail()).queryByRole("button", { name: "Lịch sử thao tác" })).not.toBeInTheDocument();
    expect(within(rail()).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("stacks above main in the calendar panel with the properties only", async () => {
    renderRail("m1", { value: { layout: "panel" } });
    await within(rail()).findByText("3/3 có mặt");
    expect(rail()).toHaveClass("order-first");
    expect(within(rail()).queryByRole("button", { name: "Lịch sử thao tác" })).not.toBeInTheDocument();
    expect(within(rail()).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("opens the history drawer from the rail link", async () => {
    renderRail("m1", { extra: { [`/api/v1/meetings/${fixtureMeeting("m1").id}/activity`]: { activity: [] } } });
    fireEvent.click(within(rail()).getByRole("button", { name: "Lịch sử thao tác" }));
    expect(await screen.findByRole("dialog", { name: "Lịch sử thao tác" })).toBeInTheDocument();
    expect(await screen.findByText("Chưa có thao tác nào.")).toBeInTheDocument();
  });
});

describe("Rail people popover (ported from the participants card)", () => {
  const m3 = fixtureMeeting("m3").id;
  const openPeople = async () => {
    fireEvent.click(await within(rail()).findByRole("button", { name: /^Người dự:/ }));
    return screen.findByRole("dialog");
  };

  it("lists who is in with their answers, and hands the host role over after a confirm", async () => {
    renderRail("m3");
    const pop = await openPeople();
    expect(within(pop).getByText("Nhận lời")).toBeInTheDocument();
    expect(within(pop).getByText("Chưa phản hồi")).toBeInTheDocument();
    fireEvent.click(within(pop).getByRole("button", { name: "Thao tác với Hà Vũ" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Chuyển chủ trì…" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Hà Vũ sẽ trở thành chủ trì/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Chuyển/ }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(`/api/v1/meetings/${m3}/host-transfer`, expect.objectContaining({ method: "POST" })),
    );
  });

  it("sets roles from the row menu", async () => {
    renderRail("m3");
    const pop = await openPeople();
    const ha = demo.meetings.m3.participants.find((p) => p.display_name_snapshot === "Hà Vũ")!;
    fireEvent.click(within(pop).getByRole("button", { name: "Thao tác với Hà Vũ" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Giao vai thư ký" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        `/api/v1/meetings/${m3}/participants/${ha.id}`,
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });

  it("asks before removing someone, in a 440 confirm", async () => {
    renderRail("m3");
    const pop = await openPeople();
    fireEvent.click(within(pop).getByRole("button", { name: "Thao tác với Minh Trần" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Gỡ" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Gỡ Minh Trần khỏi cuộc họp?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Gỡ khỏi cuộc họp" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(expect.stringContaining(`/api/v1/meetings/${m3}/participants/`), expect.objectContaining({ method: "DELETE" })));
  });

  it("gives the host's own row its standing only, never a removal or a hand-over", async () => {
    renderRail("m3");
    const pop = await openPeople();
    fireEvent.click(within(pop).getByRole("button", { name: "Thao tác với Lan Phạm" }));
    await screen.findByRole("menuitem", { name: "Chuyển sang dự thính" });
    expect(screen.queryByRole("menuitem", { name: "Gỡ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Chuyển chủ trì…" })).not.toBeInTheDocument();
  });

  it("invites from the popover's foot, not a picker that grabs focus", async () => {
    renderRail("m3");
    const pop = await openPeople();
    expect(within(pop).queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(within(pop).getByRole("button", { name: "Thêm người" }));
    expect(await screen.findByRole("dialog", { name: /Thêm người/ })).toBeInTheDocument();
  });

  it("shows a member the list without any menu", async () => {
    renderRail("m3", { viewer: "minh" });
    const pop = await openPeople();
    expect(within(pop).getByText("Hà Vũ")).toBeInTheDocument();
    expect(within(pop).queryByRole("button", { name: /Thao tác với/ })).not.toBeInTheDocument();
    expect(within(pop).queryByRole("button", { name: "Thêm người" })).not.toBeInTheDocument();
  });

  it("marks the ended roll and says it was finalized", async () => {
    renderRail("m1");
    const pop = await openPeople();
    expect(within(pop).getAllByText("Có mặt")).toHaveLength(3);
    expect(within(pop).getByText("Đã chốt điểm danh")).toBeInTheDocument();
  });

  it("does not read the roll before the meeting", async () => {
    renderRail("m3");
    await openPeople();
    expect(called("/attendance")).toBe(false);
  });
});

describe("Rail AI popover (ported from the AI access card)", () => {
  const m3 = fixtureMeeting("m3").id;

  it("lets the host switch the scribe and share the AI content", async () => {
    renderRail("m3");
    fireEvent.click(await within(rail()).findByRole("button", { name: /^Thư ký UNI: bật/ }));
    const scribe = await screen.findByRole("switch", { name: "Thư ký UNI" });
    expect(scribe).toBeChecked();
    fireEvent.click(scribe);
    fireEvent.click(screen.getByRole("switch", { name: "Chia sẻ nội dung AI với cả workspace" }));
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(`/api/v1/meetings/${m3}/scribe`, expect.objectContaining({ method: "PUT", body: { enabled: false } }));
      expect(requestMock).toHaveBeenCalledWith(`/api/v1/meetings/${m3}/ai-sharing`, expect.objectContaining({ method: "PUT", body: { shared: true } }));
    });
  });

  it("says the organization turned the scribe off instead of a switch that would be refused", async () => {
    renderRail("m3", { extra: { [`${ws}/meeting-capabilities`]: { scribe: false, scribe_policy: "off" } } });
    fireEvent.click(await within(rail()).findByRole("button", { name: "Thư ký UNI: không bật, đổi" }));
    expect(await screen.findByTestId("meeting-scribe-off-by-policy")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("says the scribe is listening while live, with nothing to open", async () => {
    renderRail("m4");
    expect(await within(rail()).findByText(/^Đang nghe/)).toBeInTheDocument();
    expect(within(rail()).queryByRole("button", { name: /^Thư ký UNI/ })).not.toBeInTheDocument();
  });
});

describe("Rail dial-in (ported from the dial-in card)", () => {
  const m3 = fixtureMeeting("m3").id;
  const on = { enabled: true, number: "+84 28 7300 0000", pin: "042137" };

  it("renders nothing when the meeting takes no calls", async () => {
    renderRail("m3");
    await within(rail()).findByText("3 người");
    expect(within(rail()).queryByText("Gọi vào")).not.toBeInTheDocument();
  });

  it("shows the number and PIN, dials from a phone and copies both", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderRail("m3", { viewer: "minh", extra: { [`/api/v1/meetings/${m3}/dial-in`]: on } });
    fireEvent.click(await within(rail()).findByRole("button", { name: /Gọi vào/ }));
    const link = await screen.findByRole("link", { name: "+84 28 7300 0000" });
    expect(link).toHaveAttribute("href", "tel:+842873000000");
    expect(screen.getByText("042137")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đổi mã PIN" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sao chép số tổng đài" }));
    fireEvent.click(screen.getByRole("button", { name: "Sao chép mã PIN" }));
    expect(writeText).toHaveBeenCalledWith("+84 28 7300 0000");
    expect(writeText).toHaveBeenCalledWith("042137");
  });

  it("lets the host draw a new PIN after confirming, and says a failure in the rail", async () => {
    renderRail("m3", { extra: { [`/api/v1/meetings/${m3}/dial-in`]: on } });
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) =>
      init?.method === "POST" ? Promise.reject(new ApiError("x", "internal", 500)) : base(path, init),
    );
    fireEvent.click(await within(rail()).findByRole("button", { name: /Gọi vào/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Đổi mã PIN" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Đổi mã PIN" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await screen.findByRole("alert")).toHaveTextContent(/./);
    expect(requestMock).toHaveBeenCalledWith(`/api/v1/meetings/${m3}/dial-in/pin`, { method: "POST" });
  });
});

describe("RailOutline on the minutes tab", () => {
  it("lists the document's sections with their counts", async () => {
    const tabs = { list: ["overview", "transcript", "minutes"] as const, current: "minutes" as const, set: () => {} };
    renderRail("m1", {
      value: { tabs: { ...tabs, list: [...tabs.list] } },
      ui: (
        <>
          <article>
            <section id="minutes-sec-0" data-outline="Thành phần">
              <p>Có mặt 3/3 thành viên (100%).</p>
              <ul><li>Có mặt: Lan Phạm, Hà Vũ, Minh Trần</li></ul>
            </section>
            <section id="minutes-sec-1" data-outline="Nội dung">
              <p>Đủ 3/3 thành viên.</p>
              <h4>Rà soát</h4>
              <h4>Tiến độ</h4>
            </section>
            <section id="minutes-sec-2" data-outline="Kết luận">
              <ol><li>a</li><li>b</li></ol>
            </section>
          </article>
          <DetailRail />
        </>
      ),
    });
    const nav = await screen.findByRole("navigation", { name: "Trên trang này" });
    // The drawn count is aria-hidden; the label is read with the count after it.
    const rows = within(nav)
      .getAllByRole("link")
      .map((a) => [...a.childNodes].filter((n) => !(n instanceof Element && n.hasAttribute("aria-hidden"))).map((n) => n.textContent).join(""));
    expect(rows).toEqual(["Thành phần 3/3", "Nội dung 2 chủ đề", "Kết luận 2"]);
  });
});


describe("Phone rail (PhoneAfter, PhoneLive)", () => {
  it("draws no stacked rail after the meeting; the people row opens the properties in a sheet", async () => {
    const { unmount } = renderRail("m1", { value: { isPhone: true } });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    unmount();
    renderRail("m1", { value: { isPhone: true }, ui: <PhonePeopleRow /> });
    fireEvent.click(await screen.findByRole("button", { name: "Chi tiết cuộc họp: 3/3 có mặt" }));
    expect(await screen.findByRole("dialog", { name: "Chi tiết cuộc họp" })).toHaveTextContent(/Chủ trìLPLan Phạm/);
  });

  it("puts the roll and the carried-over work after the notes while live", async () => {
    renderRail("m4", { value: { isPhone: true } });
    expect(await screen.findByRole("button", { name: /^Điểm danh: .*\. Mở điểm danh$/ })).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});
