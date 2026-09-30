import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { MeetingParticipant } from "@uniwork/core/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { toast } from "sonner";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingDutyMenuItems, dutyRole } from "./meeting-duty-menu-items";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({
    participant: { id: "p1", meeting_id: "m1", principal_type: "USER", role: "ATTENDEE", status: "ACTIVE" },
  });
});

const base = { id: "p1", meeting_id: "m1", role: "ATTENDEE", status: "ACTIVE", display_name_snapshot: "An" };

function open(participant: MeetingParticipant) {
  render(
    wrapWithNav(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <MeetingDutyMenuItems meetingId="m1" participant={participant} name="An" />
        </DropdownMenuContent>
      </DropdownMenu>,
    ),
  );
}

describe("MeetingDutyMenuItems", () => {
  it("offers observer + secretary for a member account", async () => {
    open({ ...base, principal_type: "USER", standing: "MEMBER", is_secretary: false });
    expect(screen.getByRole("menuitem", { name: "Chuyển sang dự thính" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Giao vai thư ký" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/participants/p1", {
        method: "PATCH",
        body: { is_secretary: true },
      }),
    );
    // The toast says who now holds which role, not just "updated".
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("An là thư ký"));
  });

  it("offers to lift the secretary role and to restore a member", () => {
    open({ ...base, principal_type: "USER", standing: "OBSERVER", is_secretary: true });
    expect(screen.getByRole("menuitem", { name: "Bỏ vai thư ký" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Chuyển về thành viên" })).toBeInTheDocument();
  });

  it("never offers the secretary role to a guest", () => {
    open({ ...base, principal_type: "GUEST", standing: "OBSERVER" });
    expect(screen.queryByRole("menuitem", { name: "Giao vai thư ký" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Chuyển về thành viên" })).toBeInTheDocument();
  });
});

describe("dutyRole", () => {
  it("secretary wins over observer; members carry no chip", () => {
    expect(dutyRole({ principal_type: "USER", standing: "OBSERVER", is_secretary: true })).toBe("secretary");
    expect(dutyRole({ principal_type: "USER", standing: "OBSERVER" })).toBe("observer");
    expect(dutyRole({ principal_type: "USER", standing: "MEMBER" })).toBeNull();
    expect(dutyRole(undefined)).toBeNull();
  });
});
