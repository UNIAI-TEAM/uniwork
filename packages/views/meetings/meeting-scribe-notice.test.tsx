import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingScribeNotice } from "./meeting-scribe-notice";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  sessionStorage.clear();
});

// UNI-1995 access (#2): informed consent before anyone is transcribed.
describe("MeetingScribeNotice", () => {
  it("says the scribe is an AI and who keeps the transcript, and leaves where the audio goes to the settings", () => {
    render(<MeetingScribeNotice meetingKey="m1" scribeOn />);
    const notice = screen.getByTestId("meeting-scribe-notice");
    expect(notice).toHaveTextContent("Cuộc họp này có Thư ký UNI");
    expect(notice).toHaveTextContent(/tổ chức chủ trì cuộc họp lưu/);
    expect(notice).toHaveTextContent(/là trợ lý AI của UniWork/);
    expect(notice).not.toHaveTextContent(/Việt Nam/);
  });

  it("is not shown where the meeting has no scribe", () => {
    render(<MeetingScribeNotice meetingKey="m1" scribeOn={false} />);
    expect(screen.queryByTestId("meeting-scribe-notice")).not.toBeInTheDocument();
  });

  it("is asked once per meeting: acknowledged in the prejoin, the lobby does not ask again", async () => {
    const first = render(<MeetingScribeNotice meetingKey="m1" scribeOn />);
    await userEvent.click(screen.getByRole("button", { name: "Đã hiểu" }));
    expect(screen.queryByTestId("meeting-scribe-notice")).not.toBeInTheDocument();
    first.unmount();
    render(<MeetingScribeNotice meetingKey="m1" scribeOn />);
    expect(screen.queryByTestId("meeting-scribe-notice")).not.toBeInTheDocument();
    render(<MeetingScribeNotice meetingKey="m2" scribeOn />);
    expect(screen.getByTestId("meeting-scribe-notice")).toBeInTheDocument();
  });
});
