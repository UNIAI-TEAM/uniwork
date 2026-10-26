import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../../test/api-mock";
import { DetailContext, type DetailContextValue } from "../detail-context";
import { demo, demoUser, demoWorkspace, detailValue, fixtureMeeting, routeMeeting, type DemoUserKey } from "../test-fixtures";
import { ScheduledBody } from "./scheduled-body";
import { StripRsvpRow } from "./strip-rsvp-row";
import { useSeriesStrip } from "./use-series-strip";

const copyText = vi.hoisted(() => vi.fn(async (_text: string) => true));
vi.mock("@uniwork/ui/lib/clipboard", () => ({ copyText }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const m3 = fixtureMeeting("m3");
const m1 = fixtureMeeting("m1");
const m3Path = `/api/v1/meetings/${m3.id}`;
const m1Path = `/api/v1/meetings/${m1.id}`;

function renderSlot(ui: ReactElement, who: DemoUserKey, value: Partial<DetailContextValue> = {}, extra: Record<string, unknown> = {}) {
  routeMeeting("m3", { viewer: who, extra });
  setSessionUser(demoUser(who));
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={demoWorkspace} user={demoUser(who)}>
        <DetailContext.Provider value={detailValue("m3", { user: who, ...value })}>{ui}</DetailContext.Provider>
      </WorkspaceProvider>,
    ),
  );
}

const callsTo = (suffix: string, method?: string) =>
  requestMock.mock.calls.filter(
    ([path, init]) => String(path).endsWith(suffix) && (!method || (init as { method?: string } | undefined)?.method === method),
  );

beforeEach(() => {
  requestMock.mockReset();
  copyText.mockClear();
});

describe("StripRsvpRow", () => {
  it("asks with none chosen, saves an answer, folds it into one line and reopens on Đổi", async () => {
    const minh = demo.meetings.m3.invitations.find((inv) => inv.response_status === "PENDING")!;
    const { rerender } = renderSlot(<StripRsvpRow variant="strip" />, "minh");
    expect(screen.getByText("Lan Phạm mời bạn tham dự")).toBeInTheDocument();
    // Times read in the viewer's zone; the suite pins none, so only their shape is asserted.
    // The hour is its own <time> (board), so the line is matched on the paragraph's whole text.
    const opens = screen.getByText((_, el) => el?.tagName === "P" && /^Phòng họp mở lúc \d\d:\d\d \S/.test(el.textContent ?? ""));
    expect(opens.querySelector("time")).toHaveTextContent(/^\d\d:\d\d$/);
    const group = screen.getByRole("group", { name: "Trả lời lời mời của Lan Phạm" });
    for (const choice of within(group).getAllByRole("button")) expect(choice).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Thêm vào lịch" })).toBeInTheDocument();

    fireEvent.click(within(group).getByRole("button", { name: "Tham dự" }));
    await waitFor(() => expect(callsTo(`/invitations/${minh.id}/response`, "PUT")).toHaveLength(1));

    // The server now holds the answer: the strip reads it from the invitations it is given.
    const answered = detailValue("m3", {
      user: "minh",
      invitations: demo.meetings.m3.invitations.map((inv) => (inv.id === minh.id ? { ...inv, response_status: "ACCEPTED" } : inv)),
    });
    rerender(
      wrapWithNav(
        <WorkspaceProvider workspace={demoWorkspace} user={demoUser("minh")}>
          <DetailContext.Provider value={answered}>
            <StripRsvpRow variant="strip" />
          </DetailContext.Provider>
        </WorkspaceProvider>,
      ),
    );
    expect(await screen.findByText("Bạn tham dự")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Trả lời lời mời của Lan Phạm" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đổi câu trả lời" }));
    expect(screen.getByRole("button", { name: "Tham dự" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lets a keyboard reach any answer without saving the ones on the way, and keeps focus while saving", async () => {
    const minh = demo.meetings.m3.invitations.find((inv) => inv.response_status === "PENDING")!;
    const { rerender } = renderSlot(<StripRsvpRow variant="strip" />, "minh");
    // The save stays in flight until `saved()`.
    let saved = () => {};
    const fixture = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) =>
      init?.method === "PUT" ? new Promise<void>((resolve) => (saved = resolve)) : fixture(path, init),
    );
    const user = userEvent.setup();
    const group = screen.getByRole("group", { name: "Trả lời lời mời của Lan Phạm" });
    within(group).getByRole("button", { name: "Tham dự" }).focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    await user.tab();
    await user.tab();
    const decline = within(group).getByRole("button", { name: "Từ chối" });
    expect(decline).toHaveFocus();
    expect(callsTo(`/invitations/${minh.id}/response`, "PUT")).toHaveLength(0);

    await user.keyboard("{Enter}");
    await waitFor(() => expect(callsTo(`/invitations/${minh.id}/response`, "PUT")).toHaveLength(1));
    expect((callsTo(`/invitations/${minh.id}/response`, "PUT")[0]![1] as { body?: unknown }).body).toEqual({ response: "DECLINED" });
    await waitFor(() => expect(decline).toHaveAttribute("aria-pressed", "true"));
    expect(decline).toHaveAttribute("aria-disabled", "true");
    expect(decline).toHaveFocus();
    // A second answer while the first is saving is not sent.
    await user.click(within(group).getByRole("button", { name: "Tham dự" }));
    expect(callsTo(`/invitations/${minh.id}/response`, "PUT")).toHaveLength(1);

    // Saved: the control folds into the answered line and focus moves to "Đổi".
    decline.focus();
    saved();
    const answered = detailValue("m3", {
      user: "minh",
      invitations: demo.meetings.m3.invitations.map((inv) => (inv.id === minh.id ? { ...inv, response_status: "DECLINED" } : inv)),
    });
    rerender(
      wrapWithNav(
        <WorkspaceProvider workspace={demoWorkspace} user={demoUser("minh")}>
          <DetailContext.Provider value={answered}>
            <StripRsvpRow variant="strip" />
          </DetailContext.Provider>
        </WorkspaceProvider>,
      ),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Đổi câu trả lời" })).toHaveFocus());
  });

  it("puts the answer in the phone bar and keeps the room row in the strip", () => {
    const { unmount } = renderSlot(<StripRsvpRow variant="phoneBar" />, "minh", { isPhone: true });
    expect(screen.getByText("mời bạn", { exact: false })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Trả lời lời mời của Lan Phạm" })).getAllByRole("button")).toHaveLength(3);
    unmount();
    renderSlot(<StripRsvpRow variant="strip" actions={<button type="button">Vào phòng họp</button>} />, "minh", { isPhone: true });
    expect(screen.queryByRole("group", { name: "Trả lời lời mời của Lan Phạm" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Phòng họp" })).toHaveTextContent(/Phòng họp mở lúc \d\d:\d\d/);
    expect(screen.getByRole("button", { name: "Vào phòng họp" })).toBeInTheDocument();
  });

  it("renders nothing for someone without an invitation (the host)", () => {
    const { container } = renderSlot(<StripRsvpRow variant="strip" />, "lan");
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ScheduledBody", () => {
  const link = demo.meetings.m3.invite_links.invite_links[0]!;

  it("lets the host copy a guest link the server can show again", async () => {
    renderSlot(<ScheduledBody />, "lan", {}, { [`${m3Path}/invite-links`]: { invite_links: [{ ...link, secret: "s3cret" }] } });
    expect(await screen.findByText("Agency Ánh Dương")).toBeInTheDocument();
    const meta = screen.getByText((_, el) => el?.tagName === "P" && /^Chủ trì duyệt · 0\/5 lượt · hết hạn \d\d:\d\d T\d \d\d\/10$/.test(el.textContent ?? ""));
    expect(meta.querySelector("time")).toHaveTextContent(/^\d\d:\d\d$/);
    fireEvent.click(screen.getByRole("button", { name: "Sao chép liên kết" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(expect.stringContaining(`/invite/meeting/${link.id}#secret=s3cret`)));
  });

  it("offers a new link, not a copy, when the secret is gone, and revokes only after the confirm", async () => {
    renderSlot(<ScheduledBody />, "lan");
    expect(await screen.findByText("Agency Ánh Dương")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sao chép liên kết" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Tạo liên kết mới thay cho Agency Ánh Dương/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thao tác khác với liên kết Agency Ánh Dương: thu hồi" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Thu hồi liên kết" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(callsTo(`/invite-links/${link.id}/revoke`)).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole("button", { name: "Thu hồi liên kết" }));
    await waitFor(() => expect(callsTo(`/invite-links/${link.id}/revoke`, "POST")).toHaveLength(1));
  });

  it("never fetches guest links for a member, and switches carried-over work between theirs and all", async () => {
    renderSlot(<ScheduledBody />, "minh");
    const list = await screen.findByRole("list", { name: "Việc còn tồn" });
    expect(within(list).getAllByRole("link")).toHaveLength(2);
    expect(screen.getByText("từ Giao ban tuần 43")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /^Tất cả/ }));
    expect(within(screen.getByRole("list", { name: "Việc còn tồn" })).getAllByRole("link")).toHaveLength(4);
    expect(callsTo("/invite-links")).toHaveLength(0);
    expect(screen.queryByText(/^Từ Giao ban tuần 43/)).not.toBeInTheDocument();
  });

  it("folds carried-over work to one line for the host", async () => {
    renderSlot(<ScheduledBody />, "lan");
    const line = await screen.findByRole("button", { name: /^Việc còn tồn 4 Minh Trần 2 · Hà Vũ 2 · hạn sớm nhất T2 26\/10/ });
    expect(line).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(line);
    expect(within(screen.getByRole("list", { name: "Việc còn tồn" })).getAllByRole("link")).toHaveLength(4);
  });

  it("briefs a follow-up from the previous meeting of its series", async () => {
    const m1Bundle = demo.meetings.m1;
    renderSlot(
      <ScheduledBody />,
      "lan",
      { meeting: { ...m3, previous_meeting_id: m1.id } },
      {
        [m1Path]: { meeting: m1 },
        [`${m1Path}/summary`]: m1Bundle.summary,
        [`${m1Path}/action-items`]: m1Bundle.action_items,
      },
    );
    expect(await screen.findByRole("heading", { name: "Từ Giao ban tuần 43" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Việc chưa xong" }).children).toHaveLength(4);
    expect(await screen.findByRole("list", { name: "Câu hỏi còn mở" })).toBeInTheDocument();
    expect(screen.getByText(/^Từ tóm tắt Giao ban tuần 43, soạn \d\d:\d\d \d\d\/10$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Quyết định đã chốt\s*10/ })).toBeInTheDocument();
    // The series brief lists the previous meeting's work, so no second "Việc còn tồn".
    expect(screen.queryByRole("button", { name: /^Việc còn tồn/ })).not.toBeInTheDocument();
  });

  it("words the host's strip as a follow-up: who accepted, what carries on, what is missing", async () => {
    function Probe() {
      const line = useSeriesStrip(true);
      return line ? <p>{`${line.lead} · ${line.rest} / ${line.caption}`}</p> : null;
    }
    const m1Bundle = demo.meetings.m1;
    renderSlot(
      <Probe />,
      "lan",
      { meeting: { ...m3, previous_meeting_id: m1.id }, participants: detailValue("m3").participants.map((p) => ({ ...p, is_secretary: false })) },
      {
        [m1Path]: { meeting: m1 },
        [`${m1Path}/summary`]: m1Bundle.summary,
        [`${m1Path}/action-items`]: m1Bundle.action_items,
      },
    );
    expect(
      await screen.findByText("1 người đã nhận lời · tiếp nối Giao ban tuần 43 / 4 việc chưa xong · 4 câu hỏi còn mở · chưa chọn thư ký"),
    ).toBeInTheDocument();
  });
});
