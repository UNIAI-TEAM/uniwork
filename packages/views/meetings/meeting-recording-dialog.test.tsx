import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { MeetingRecordingDialog } from "./meeting-recording-dialog";

const resolvePlayback = vi.fn();
vi.mock("@uniwork/core/api/endpoints/meetings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@uniwork/core/api/endpoints/meetings")>()),
  resolveMeetingRecordingPlayback: (...args: unknown[]) => resolvePlayback(...args),
}));

beforeAll(() => {
  initI18n();
});

describe("MeetingRecordingDialog", () => {
  it("holds the player's shape with an announced skeleton while loading", () => {
    resolvePlayback.mockReturnValue(new Promise(() => {}));
    render(wrap(<MeetingRecordingDialog open onOpenChange={() => {}} meetingId="m1" recordingId="r-loading" />));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Đang tải bản ghi…");
    expect(status.querySelector(".aspect-video")).not.toBeNull();
  });

  it("reports a failed load as an alert", async () => {
    resolvePlayback.mockRejectedValue(new Error("boom"));
    render(wrap(<MeetingRecordingDialog open onOpenChange={() => {}} meetingId="m1" recordingId="r-error" />));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không phát được bản ghi. Thử lại sau.");
  });
});
