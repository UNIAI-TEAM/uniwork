import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
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

  it("dials the number from a phone and copies the number and the PIN", async () => {
    requestMock.mockResolvedValue(on);
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(wrapWithNav(<MeetingDialInSection meetingId="m1" canHost={false} />));
    const link = await screen.findByRole("link", { name: "+84 28 7300 0000" });
    expect(link).toHaveAttribute("href", "tel:+842873000000");
    // Reads as a link at rest and is a full touch target.
    expect(link).toHaveClass("underline", "pointer-coarse:min-h-11");
    fireEvent.click(screen.getByRole("button", { name: "Sao chép số tổng đài" }));
    fireEvent.click(screen.getByRole("button", { name: "Sao chép mã PIN" }));
    expect(writeText).toHaveBeenCalledWith("+84 28 7300 0000");
    expect(writeText).toHaveBeenCalledWith("042137");
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

  it("says a PIN that did not change on the card, not in a toast behind the dialog", async () => {
    requestMock.mockImplementation((_path: unknown, init?: { method?: string }) =>
      init?.method === "POST" ? Promise.reject(new ApiError("x", "internal", 500)) : Promise.resolve(on),
    );
    render(wrapWithNav(<MeetingDialInSection meetingId="m1" canHost />));
    fireEvent.click(await screen.findByRole("button", { name: "Đổi mã PIN" }));
    const confirm = await screen.findAllByRole("button", { name: "Đổi mã PIN" });
    fireEvent.click(confirm[confirm.length - 1]!);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByText("042137")).toBeInTheDocument();
  });
});
