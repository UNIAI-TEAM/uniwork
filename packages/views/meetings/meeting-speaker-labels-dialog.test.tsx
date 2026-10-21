import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { toast } from "sonner";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingSpeakerLabelsButton, MeetingSpeakerLabelsDialog } from "./meeting-speaker-labels-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const unassigned = {
  id: "l1",
  label_key: "uw_participant_p1:AJ_1-TR_a-1:A",
  speaker: "A",
  number: 1,
  sample: "Chốt ship thứ Sáu",
};
// The next STT session's "A": another speaker, numbered 2 in the meeting.
const assigned = { ...unassigned, id: "l2", label_key: "uw_participant_p1:AJ_1-TR_a-2:A", number: 2, user_id: "u1", assigned_name: "An" };

let labels: unknown[] = [];

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  labels = [unassigned, assigned];
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
    const p = String(path);
    if (p.endsWith("/speaker-labels")) return Promise.resolve({ labels });
    if (p.endsWith("/members")) return Promise.resolve({ members: [{ user_id: "u1", display_name: "An", role: "member" }] });
    if (init?.method === "PUT") return Promise.resolve({ label: { ...unassigned, name: "Chị Lan", assigned_name: "Chị Lan" } });
    return Promise.resolve({});
  });
});

function openDialog() {
  render(wrapWithNav(<MeetingSpeakerLabelsDialog meetingId="m1" workspaceId="w1" open onOpenChange={() => {}} />));
}

describe("MeetingSpeakerLabelsDialog", () => {
  it("lists each speaker with a line they said, and the name already given", async () => {
    openDialog();
    expect(await screen.findByText("Hội trường · Người nói 1")).toBeInTheDocument();
    expect(screen.getAllByText('"Chốt ship thứ Sáu"')).toHaveLength(2);
    // An assigned speaker leads with the name, the label under it.
    expect(screen.getByText("An", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Hội trường · Người nói 2")).toBeInTheDocument();
  });

  it("saves a free name for a speaker", async () => {
    openDialog();
    const input = await screen.findByRole("textbox", { name: "Hội trường · Người nói 1 · Hoặc nhập tên" });
    fireEvent.change(input, { target: { value: " Chị Lan " } });
    // One save for the dialog; only the row that changed is sent.
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/speaker-labels/l1", {
        method: "PUT",
        body: { name: "Chị Lan" },
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã lưu tên người nói"));
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/speaker-labels/l2", expect.anything());
  });

  it("names an uploaded recording's speaker without the room mic", async () => {
    labels = [{ ...unassigned, label_key: "upload:T1:A" }];
    openDialog();
    expect(await screen.findByText("Người nói 1")).toBeInTheDocument();
  });

  it("keeps the draft on its row and says why the server refused", async () => {
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      const p = String(path);
      if (p.endsWith("/speaker-labels")) return Promise.resolve({ labels });
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      if (init?.method === "PUT") return Promise.reject(new ApiError("người được gán không phải thành viên workspace", "assignee_not_member", 422));
      return Promise.resolve({});
    });
    openDialog();
    const input = await screen.findByRole("textbox", { name: "Hội trường · Người nói 1 · Hoặc nhập tên" });
    fireEvent.change(input, { target: { value: "Chị Lan" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/speaker-labels/l1", {
        method: "PUT",
        body: { name: "Chị Lan" },
      }),
    );
    // The refusal stays on its row, the dialog stays open with the draft.
    expect(await screen.findByRole("alert")).toHaveTextContent("người được gán không phải thành viên workspace");
    expect(input).toHaveValue("Chị Lan");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("says when there is nobody to name yet", async () => {
    labels = [];
    openDialog();
    expect(await screen.findByText("Chưa có người nói nào cần gán tên.")).toBeInTheDocument();
  });
});

describe("MeetingSpeakerLabelsButton", () => {
  it("appears only once there is a speaker to name", async () => {
    labels = [];
    const view = render(wrapWithNav(<MeetingSpeakerLabelsButton meetingId="m1" workspaceId="w1" />));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Gán người nói" })).not.toBeInTheDocument();
    view.unmount();
    labels = [unassigned];
    render(wrapWithNav(<MeetingSpeakerLabelsButton meetingId="m1" workspaceId="w1" />));
    fireEvent.click(await screen.findByRole("button", { name: "Gán người nói" }));
    expect(await screen.findByRole("dialog", { name: "Gán người nói" })).toBeInTheDocument();
  });
});
