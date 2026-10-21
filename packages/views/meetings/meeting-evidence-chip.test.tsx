import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { formatOffset, MeetingEvidenceChip, recordingOffset } from "./meeting-evidence-chip";

beforeAll(() => {
  initI18n();
});

const recording = {
  id: "r1",
  meeting_id: "m1",
  status: "COMPLETE",
  started_at: "2026-10-20T02:00:00Z",
  ended_at: "2026-10-20T03:00:00Z",
};

function respond(items: unknown[], recordings: unknown[] = [recording]) {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.includes("/evidence?")) return Promise.resolve({ items });
    if (p.endsWith("/recordings")) return Promise.resolve({ recordings });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  respond([]);
});

describe("recordingOffset", () => {
  it("places a moment in the COMPLETE recording running then, and nowhere else", () => {
    expect(recordingOffset("2026-10-20T02:01:15Z", [recording])).toEqual({ recordingId: "r1", seconds: 75 });
    expect(recordingOffset("2026-10-20T01:59:00Z", [recording])).toBeNull();
    expect(recordingOffset("2026-10-20T03:00:01Z", [recording])).toBeNull();
    expect(recordingOffset("2026-10-20T02:01:15Z", [{ ...recording, status: "FAILED" }])).toBeNull();
    expect(recordingOffset("2026-10-20T02:01:15Z", [{ ...recording, started_at: undefined }])).toBeNull();
    expect(recordingOffset(null, [recording])).toBeNull();
    // A recording with no end yet still covers what came after its start.
    expect(recordingOffset("2026-10-20T05:00:00Z", [{ ...recording, ended_at: "" }])?.seconds).toBe(3 * 3600);
  });

  it("formats the offset as m:ss, or h:mm:ss past an hour", () => {
    expect(formatOffset(75)).toBe("1:15");
    expect(formatOffset(3725)).toBe("1:02:05");
  });
});

describe("MeetingEvidenceChip", () => {
  it("renders nothing for an item that cites nothing", () => {
    const { container } = render(wrap(<MeetingEvidenceChip meetingId="m1" evidence={[]} />));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the cited lines when opened, and offers the recording at a spoken line", async () => {
    respond([
      { kind: "segment", id: "g1", author: "Lan", text: "Chốt thứ Sáu", at: "2026-10-20T02:01:15Z" },
      { kind: "note", id: "n1", author: "Minh", text: "Nhớ gửi bản nháp", at: "2026-10-20T02:05:00Z" },
    ]);
    const u = userEvent.setup();
    render(
      wrap(
        <MeetingEvidenceChip
          meetingId="m1"
          evidence={[
            { kind: "segment", id: "g1" },
            { kind: "note", id: "n1" },
          ]}
        />,
      ),
    );
    expect(requestMock).not.toHaveBeenCalled();
    await u.click(screen.getByRole("button", { name: "Căn cứ 2 nguồn" }));
    expect(await screen.findByText("Chốt thứ Sáu")).toBeInTheDocument();
    expect(screen.getByText("Nhớ gửi bản nháp")).toBeInTheDocument();
    expect(screen.getByText("Lời nói")).toBeInTheDocument();
    expect(screen.getByText("Ghi chú")).toBeInTheDocument();
    expect(String(requestMock.mock.calls.find((c) => String(c[0]).includes("/evidence?"))?.[0])).toBe(
      "/api/v1/meetings/m1/evidence?refs=segment%3Ag1%2Cnote%3An1",
    );
    // Only the spoken line has a moment in the recording.
    expect(await screen.findByRole("button", { name: "Mở bản ghi tại 1:15" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Mở bản ghi/ })).toHaveLength(1);
  });

  it("offers no recording when none covers the line, and says when the sources are gone", async () => {
    respond([{ kind: "segment", id: "g1", author: "Lan", text: "Chốt thứ Sáu", at: "2026-10-20T02:01:15Z" }], []);
    const u = userEvent.setup();
    const { unmount } = render(wrap(<MeetingEvidenceChip meetingId="m1" evidence={[{ kind: "segment", id: "g1" }]} />));
    await u.click(screen.getByRole("button", { name: "Căn cứ 1 nguồn" }));
    expect(await screen.findByText("Chốt thứ Sáu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mở bản ghi/ })).not.toBeInTheDocument();
    unmount();

    respond([]);
    render(wrap(<MeetingEvidenceChip meetingId="m1" evidence={[{ kind: "chat", id: "c1" }]} />));
    await u.click(screen.getByRole("button", { name: "Căn cứ 1 nguồn" }));
    expect(await screen.findByText("Các nguồn này không còn.")).toBeInTheDocument();
  });

  it("says the sources did not load and offers a retry", async () => {
    let fail = true;
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.includes("/evidence?")) {
        return fail
          ? Promise.reject(new ApiError("nope", "forbidden", 403))
          : Promise.resolve({ items: [{ kind: "chat", id: "c1", author: "Lan", text: "Chốt thứ Sáu", at: "2026-10-20T02:01:15Z" }] });
      }
      return Promise.resolve({});
    });
    const u = userEvent.setup();
    render(wrap(<MeetingEvidenceChip meetingId="m1" evidence={[{ kind: "chat", id: "c1" }]} />));
    await u.click(screen.getByRole("button", { name: "Căn cứ 1 nguồn" }));
    expect(await screen.findByText("Không tải được căn cứ.")).toBeInTheDocument();
    fail = false;
    await u.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Chốt thứ Sáu")).toBeInTheDocument();
  });
});
