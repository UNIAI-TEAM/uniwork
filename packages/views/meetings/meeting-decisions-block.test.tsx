import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { MeetingMotion } from "@uniwork/core/types/meeting";
import { MeetingDecisionsBlock } from "./meeting-decisions-block";

beforeAll(() => {
  initI18n();
});

const closed = (over: Partial<MeetingMotion>): MeetingMotion => ({
  id: "mo1",
  title: "Thông qua kế hoạch quý IV",
  description: "",
  position: 1,
  ballot_mode: "SECRET",
  threshold: "MAJORITY",
  base: "PRESENT",
  status: "CLOSED",
  roll_size: 4,
  total_members: 5,
  cast_count: 4,
  result: { yes: 3, no: 1, abstain: 0, required: 3, outcome: "PASSED" },
  voters: null,
  my_ballot: { on_roll: true, cast: true, choice: null },
  ...over,
});

describe("MeetingDecisionsBlock", () => {
  it("lists the recorded votes first, then the AI's decisions", () => {
    render(
      <MeetingDecisionsBlock
        voted={[
          closed({}),
          closed({
            id: "mo2",
            title: "Tăng ngân sách",
            position: 2,
            result: { yes: 1, no: 2, abstain: 1, required: 3, outcome: "FAILED" },
          }),
        ]}
        aiDecisions={["Chốt lịch thứ Sáu"]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Quyết định" })).toBeInTheDocument();
    expect(screen.getByText("Đã biểu quyết")).toBeInTheDocument();
    expect(screen.getByText("Thông qua")).toBeInTheDocument();
    expect(screen.getByText("Không thông qua")).toBeInTheDocument();
    expect(screen.getByText("3 tán thành · 1 không tán thành · 0 không ý kiến")).toBeInTheDocument();
    expect(screen.getByText("1 tán thành · 2 không tán thành · 1 không ý kiến")).toBeInTheDocument();
    const vote = screen.getByText("Thông qua kế hoạch quý IV");
    const ai = screen.getByText("Chốt lịch thứ Sáu");
    expect(vote.compareDocumentPosition(ai) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the AI decisions without a voted group when nothing was voted", () => {
    render(<MeetingDecisionsBlock voted={[]} aiDecisions={["Chốt lịch thứ Sáu"]} />);
    expect(screen.getByText("Chốt lịch thứ Sáu")).toBeInTheDocument();
    expect(screen.queryByText("Đã biểu quyết")).not.toBeInTheDocument();
  });

  it("renders nothing when nothing was decided", () => {
    const { container } = render(<MeetingDecisionsBlock voted={[]} aiDecisions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
