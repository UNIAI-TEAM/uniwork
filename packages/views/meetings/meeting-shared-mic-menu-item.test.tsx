import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { MeetingParticipant } from "@uniwork/core/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { toast } from "sonner";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingSharedMicMenuItem } from "./meeting-shared-mic-menu-item";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.success).mockReset();
});

const base = { id: "p1", meeting_id: "m1", principal_type: "USER", role: "ATTENDEE", status: "ACTIVE" };

function open(participant: MeetingParticipant) {
  render(
    wrapWithNav(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <MeetingSharedMicMenuItem meetingId="m1" participant={participant} name="Phòng họp lớn" />
        </DropdownMenuContent>
      </DropdownMenu>,
    ),
  );
}

describe("MeetingSharedMicMenuItem", () => {
  it("makes the participant the room mic and says what that does", async () => {
    requestMock.mockResolvedValue({ participant: { ...base, shared_mic: true } });
    open(base);
    fireEvent.click(screen.getByRole("menuitem", { name: "Đặt làm mic hội trường" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/participants/p1/shared-mic", {
        method: "PUT",
        body: { enabled: true },
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Mic của Phòng họp lớn là mic hội trường: Thư ký UNI tách từng người nói"),
    );
  });

  it("lifts it again", async () => {
    requestMock.mockResolvedValue({ participant: base });
    open({ ...base, shared_mic: true });
    fireEvent.click(screen.getByRole("menuitem", { name: "Bỏ mic hội trường" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/participants/p1/shared-mic", {
        method: "PUT",
        body: { enabled: false },
      }),
    );
  });
});
