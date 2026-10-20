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
  sample: "Chốt ship thứ Sáu",
};
const assigned = { ...unassigned, id: "l2", speaker: "B", user_id: "u1", assigned_name: "An" };

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
    expect(await screen.findByText("Hội trường · Người nói A")).toBeInTheDocument();
    expect(screen.getAllByText("“Chốt ship thứ Sáu”")).toHaveLength(2);
    // An assigned speaker leads with the name, the label under it.
    expect(screen.getByText("An", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Hội trường · Người nói B")).toBeInTheDocument();
  });

  it("saves a free name for a speaker", async () => {
    openDialog();
    const input = await screen.findByRole("textbox", { name: "Hội trường · Người nói A · Hoặc nhập tên" });
    fireEvent.change(input, { target: { value: " Chị Lan " } });
    fireEvent.click(screen.getAllByRole("button", { name: "Lưu" })[0]!);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/speaker-labels/l1", {
        method: "PUT",
        body: { name: "Chị Lan" },
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã lưu tên người nói"));
  });

  it("keeps the member when a member is assigned, and says why the server refused", async () => {
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      const p = String(path);
      if (p.endsWith("/speaker-labels")) return Promise.resolve({ labels });
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      if (init?.method === "PUT") return Promise.reject(new ApiError("người được gán không phải thành viên workspace", "assignee_not_member", 422));
      return Promise.resolve({});
    });
    openDialog();
    await screen.findByText("Hội trường · Người nói B");
    fireEvent.click(screen.getAllByRole("button", { name: "Lưu" })[1]!);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/speaker-labels/l2", {
        method: "PUT",
        body: { user_id: "u1" },
      }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("người được gán không phải thành viên workspace"),
    );
  });

  it("says when there is nobody to name yet", async () => {
    labels = [];
    openDialog();
    expect(await screen.findByText("Chưa có người nói nào từ micro hội trường.")).toBeInTheDocument();
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
