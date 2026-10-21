import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingDialInSection } from "./meeting-dial-in-section";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
});

const on = { enabled: true, number: "+84 28 7300 0000", pin: "042137" };

describe("MeetingDialInSection", () => {
  it("shows the number and PIN to any member, without the host's button", async () => {
    requestMock.mockResolvedValue(on);
    render(wrapWithNav(<MeetingDialInSection meetingId="m1" canHost={false} />));
    expect(await screen.findByText("042137")).toBeInTheDocument();
    expect(screen.getByText("+84 28 7300 0000")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đổi mã PIN" })).not.toBeInTheDocument();
  });

  it("renders nothing when the meeting takes no calls", async () => {
    requestMock.mockResolvedValue({ enabled: false, number: "", pin: "" });
    const { container } = render(wrapWithNav(<MeetingDialInSection meetingId="m1" canHost />));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("lets the host draw a new PIN after confirming", async () => {
    requestMock.mockResolvedValueOnce(on).mockResolvedValueOnce({ ...on, pin: "981200" });
    render(wrapWithNav(<MeetingDialInSection meetingId="m1" canHost />));
    fireEvent.click(await screen.findByRole("button", { name: "Đổi mã PIN" }));
    const confirm = await screen.findAllByRole("button", { name: "Đổi mã PIN" });
    fireEvent.click(confirm[confirm.length - 1]!);
    expect(await screen.findByText("981200")).toBeInTheDocument();
    expect(requestMock).toHaveBeenLastCalledWith("/api/v1/meetings/m1/dial-in/pin", { method: "POST" });
  });
});
