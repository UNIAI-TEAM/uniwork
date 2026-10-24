import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Clock, Sparkles, TriangleAlert } from "lucide-react";
import { AvatarStack } from "./avatar-stack";
import { CountPill } from "./count-pill";
import { NoticeLine } from "./notice-line";
import { Dialog440, SideSheet } from "./overlay";
import { OutlineRow, RailGroup, RailLink, RailProp } from "./rail";
import { Byline, Section } from "./section";
import { Segmented, SegmentedSm } from "./segmented";
import { MeetingStatusPill } from "./status-pill";
import { Strip, StripRow } from "./strip";
import { TextButton } from "./text-button";
import { TimeChipButton, TimeChipMore } from "./time-chip";
import { TimeGutterRow } from "./time-row";

describe("MeetingStatusPill", () => {
  it("names each status with the kit's tone and mark", () => {
    const { rerender, container } = render(<MeetingStatusPill status="SCHEDULED" />);
    const pill = () => container.firstElementChild as HTMLElement;
    expect(pill()).toHaveTextContent("Sắp diễn ra");
    expect(pill()).toHaveClass("h-5.5", "rounded-sm", "text-caption", "font-medium", "bg-info-soft");
    expect(pill().querySelector(".animate-live-pulse")).toBeNull();

    rerender(<MeetingStatusPill status="IN_PROGRESS" minutes="24 phút" />);
    expect(pill()).toHaveTextContent("Đang diễn ra · 24 phút");
    expect(pill()).toHaveClass("bg-success-soft");
    expect(pill().querySelector(".animate-live-pulse")).toHaveClass("motion-reduce:animate-none");

    rerender(<MeetingStatusPill status="OVERTIME" minutes="10 phút" />);
    expect(pill()).toHaveTextContent("Quá giờ · 10 phút");
    expect(pill()).toHaveClass("bg-warning-soft");
    expect(pill().querySelector("svg")).not.toBeNull();

    for (const [status, text] of [
      ["MISSED", "Không diễn ra"],
      ["CANCELED", "Đã hủy"],
      ["ENDED", "Đã kết thúc"],
    ] as const) {
      rerender(<MeetingStatusPill status={status} />);
      expect(pill()).toHaveTextContent(text);
      expect(pill()).toHaveClass("bg-muted", "text-muted-foreground");
    }
    expect(pill().querySelector("svg")).toBeNull();
  });

  it("reads an unknown status as ended rather than failing", () => {
    const { container } = render(<MeetingStatusPill status="ARCHIVED" />);
    expect(container.firstElementChild).toHaveAttribute("data-status", "ENDED");
  });
});

describe("Strip", () => {
  it("lays out a row's text, caption and actions between hairlines", () => {
    render(
      <Strip aria-label="Việc tiếp theo">
        <StripRow
          title={
            <>
              <strong>9 việc chờ giao</strong> · Biên bản đang là bản nháp
            </>
          }
          caption="Hạn sớm nhất T2 26/10"
          actions={<button type="button">Rà và giao 9 việc</button>}
        />
        <StripRow>
          <span>custom</span>
        </StripRow>
      </Strip>,
    );
    const strip = screen.getByRole("region", { name: "Việc tiếp theo" });
    expect(strip).toHaveClass("border-y", "divide-y");
    expect(screen.getByText("9 việc chờ giao").closest("p")).toHaveClass("text-body");
    expect(screen.getByText("Hạn sớm nhất T2 26/10")).toHaveClass("text-caption", "text-muted-foreground");
    expect(screen.getByRole("button", { name: "Rà và giao 9 việc" }).parentElement).toHaveClass("flex-none");
    expect(screen.getByText("custom").parentElement).toHaveClass("min-h-14");
  });
});

describe("NoticeLine", () => {
  it("is an icon-led line in signal ink with a muted caption", () => {
    render(
      <NoticeLine tone="warning" icon={TriangleAlert} caption="Gia hạn để cho vào" role="status">
        Đã qua giờ kết thúc 22:08.
      </NoticeLine>,
    );
    const line = screen.getByRole("status");
    expect(line).toHaveClass("text-warning");
    expect(line).not.toHaveClass("rounded-lg");
    expect(screen.getByText("Gia hạn để cho vào")).toHaveClass("text-muted-foreground");
  });
});

describe("rail atoms", () => {
  it("draws a static property row and a clickable one with its chevron on the last word", () => {
    const onClick = vi.fn();
    render(
      <RailGroup label="Trên trang này" nav>
        <RailProp icon={Clock} label="Dự án" value="Ra mắt sản phẩm Q4" />
        <RailProp
          icon={Clock}
          label="Thư ký UNI"
          value="Bật · chỉ người dự họp"
          sub="15 câu"
          onClick={onClick}
          ariaLabel="Thư ký UNI: bật, đổi"
        />
      </RailGroup>,
    );
    expect(screen.getByRole("navigation", { name: "Trên trang này" })).toHaveClass("border-t", "pt-4");
    expect(screen.getByText("Ra mắt sản phẩm Q4").closest("div")).toHaveClass("grid-cols-[14px_70px_minmax(0,1fr)]");
    const button = screen.getByRole("button", { name: "Thư ký UNI: bật, đổi" });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByText("họp")).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("15 câu")).toHaveClass("text-caption");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("opens the history from a rail link and marks the current outline row", () => {
    const onClick = vi.fn();
    render(
      <>
        <RailLink count={4} onClick={onClick}>
          Việc còn tồn
        </RailLink>
        <OutlineRow href="#tom-tat" current>
          Tóm tắt
        </OutlineRow>
        <OutlineRow href="#quyet-dinh" count={10}>
          Quyết định
        </OutlineRow>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Việc còn tồn/ }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByText("4")).toHaveClass("text-muted-foreground");
    expect(screen.getByRole("link", { name: "Tóm tắt" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: /Quyết định/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("10", { ignore: "script, style, .sr-only" })).toHaveClass("tabular-nums");
    expect(screen.getByRole("link", { name: "Quyết định 10" })).toBeInTheDocument();
  });
});

describe("Section and Byline", () => {
  it("heads a section with its count, end control, byline and content", () => {
    render(
      <Section
        id="viec-can-lam"
        title="Việc cần làm"
        count="9 chờ giao · 5 đã giao"
        end={<TextButton>Chọn cả 9</TextButton>}
        byline={<Byline icon={Sparkles}>Thư ký UNI đề xuất 14 việc</Byline>}
      >
        <p>rows</p>
      </Section>,
    );
    const section = screen.getByRole("region", { name: "Việc cần làm" });
    expect(section).toHaveAttribute("id", "viec-can-lam");
    expect(section).toHaveClass("mt-10", "first:mt-8", "scroll-mt-6");
    expect(screen.getByRole("heading", { level: 2, name: "Việc cần làm" })).toHaveClass("text-title-sm", "font-semibold");
    expect(screen.getByText("Thư ký UNI đề xuất 14 việc").parentElement).toHaveClass("mt-1", "text-caption");
    expect(screen.getByText("rows").parentElement).toHaveClass("mt-3");
  });
});

describe("TextButton", () => {
  it("blocks the press while aria-disabled and stays focusable", () => {
    const onClick = vi.fn();
    const { rerender } = render(<TextButton onClick={onClick}>Soạn lại</TextButton>);
    const button = screen.getByRole("button", { name: "Soạn lại" });
    expect(button).toHaveClass("text-caption", "text-primary", "pointer-coarse:min-h-11");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    rerender(
      <TextButton onClick={onClick} aria-disabled>
        Soạn lại
      </TextButton>,
    );
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    expect(button).not.toBeDisabled();
  });
});

describe("time atoms", () => {
  it("names the chip by its full label and passes trigger props through", () => {
    render(<TimeChipButton time="09:06" ariaLabel="Xem căn cứ lúc 09:06, 4 căn cứ" aria-expanded />);
    const chip = screen.getByRole("button", { name: "Xem căn cứ lúc 09:06, 4 căn cứ" });
    expect(chip).toHaveTextContent("09:06");
    expect(chip).toHaveClass("font-mono", "before:-inset-y-3", "aria-expanded:bg-surface-selected");
    expect(chip).toHaveAttribute("aria-expanded", "true");
  });

  it("hides the +n count from screen readers and draws nothing at zero", () => {
    const { container, rerender } = render(<TimeChipMore count={3} />);
    expect(screen.getByText("+3")).toHaveAttribute("aria-hidden", "true");
    rerender(<TimeChipMore count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("puts a note's plain time in the mono gutter, a chip bled left, and the author above", () => {
    render(
      <ol>
        <TimeGutterRow time="21:03" author="Hà Vũ">
          Sự cố chỉ ảnh hưởng thanh toán QR.
        </TimeGutterRow>
        <TimeGutterRow time={<TimeChipButton time="09:03" ariaLabel="Xem căn cứ lúc 09:03" />}>Áp dụng chiết khấu.</TimeGutterRow>
      </ol>,
    );
    expect(screen.getByText("21:03").tagName).toBe("TIME");
    expect(screen.getByText("21:03")).toHaveClass("font-mono", "col-start-1");
    expect(screen.getByText("Hà Vũ")).toHaveClass("col-start-2", "font-semibold");
    expect(screen.getByText("Sự cố chỉ ảnh hưởng thanh toán QR.")).toHaveClass("max-w-150", "text-body-lg");
    expect(screen.getByRole("button", { name: "Xem căn cứ lúc 09:03" }).parentElement).toHaveClass("-ml-1.5");
  });
});

describe("CountPill", () => {
  it("draws a muted count and the warning and success states", () => {
    const { rerender } = render(<CountPill>119</CountPill>);
    expect(screen.getByText("119")).toHaveClass("h-5", "rounded-sm", "bg-muted");
    rerender(<CountPill tone="warning">Nháp</CountPill>);
    expect(screen.getByText("Nháp")).toHaveClass("bg-warning-soft", "text-warning-soft-foreground");
    rerender(<CountPill tone="success">Đã chốt</CountPill>);
    expect(screen.getByText("Đã chốt")).toHaveClass("bg-success-soft");
  });
});

describe("Segmented", () => {
  function Rsvp({ onPick }: { onPick: (v: string) => void }) {
    const [value, setValue] = useState<"yes" | "maybe" | "no" | null>(null);
    return (
      <Segmented
        legend="Trả lời lời mời của Lan Phạm"
        value={value}
        onChange={(v) => {
          setValue(v);
          onPick(v);
        }}
        options={[
          { value: "yes", label: "Tham dự" },
          { value: "maybe", label: "Chưa chắc" },
          { value: "no", label: "Từ chối" },
        ]}
      />
    );
  }

  it("is one named radio group with nothing chosen until a pick", () => {
    const onPick = vi.fn();
    render(<Rsvp onPick={onPick} />);
    const group = screen.getByRole("group", { name: "Trả lời lời mời của Lan Phạm" });
    expect(group).toHaveClass("h-10", "rounded-control", "border-input");
    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Tham dự" }));
    expect(onPick).toHaveBeenCalledWith("yes");
    expect(screen.getByRole("radio", { name: "Tham dự" })).toBeChecked();
  });

  it("draws the 32px scope switch with counts", () => {
    render(
      <SegmentedSm
        legend="Hiện việc còn tồn"
        value="mine"
        onChange={() => {}}
        options={[
          { value: "mine", label: "Của bạn", count: 2 },
          { value: "all", label: "Tất cả", count: 4 },
        ]}
      />,
    );
    expect(screen.getByRole("group", { name: "Hiện việc còn tồn" })).toHaveClass("h-8", "rounded-md");
    expect(screen.getByRole("radio", { name: "Của bạn 2" })).toBeChecked();
    expect(screen.getByText("4")).toHaveClass("tabular-nums");
  });
});

describe("AvatarStack", () => {
  const people = ["Lan Phạm", "Hà Vũ", "Minh Trần", "Tuấn Đỗ", "Bảo Nguyễn", "Long Trịnh", "An Lê"].map((name, i) => ({
    id: `p${i}`,
    name,
  }));

  it("shows five faces 2px apart, then +n", () => {
    const { container } = render(<AvatarStack people={people} />);
    const stack = container.firstElementChild as HTMLElement;
    expect(stack).toHaveAttribute("aria-hidden", "true");
    expect(stack).toHaveClass("gap-0.5");
    expect(screen.getByText("LP")).toBeInTheDocument();
    expect(screen.queryByText("LT")).toBeNull();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("draws the RSVP dot per person and opens the gap for it", () => {
    const { container } = render(
      <AvatarStack
        people={[
          { id: "a", name: "Hà Vũ", tint: "pink", rsvp: "yes" },
          { id: "b", name: "Minh Trần", tint: "teal", rsvp: "wait" },
        ]}
      />,
    );
    expect(container.firstElementChild).toHaveClass("gap-1.5");
    expect(container.querySelector("[data-rsvp='yes']")).toHaveClass("bg-success");
    expect(container.querySelector("[data-rsvp='wait']")).toHaveClass("inset-ring-input");
    expect(screen.getByText("HV")).toHaveClass("bg-tint-pink", "size-5");
  });
});

describe("overlays", () => {
  it("opens a 560 side sheet over the scrim with its own close button and foot", () => {
    const onOpenChange = vi.fn();
    render(
      <SideSheet open onOpenChange={onOpenChange} width={560} title="Rà và giao 9 việc" footer={<button type="button">Giao 9 việc</button>}>
        <p>table</p>
      </SideSheet>,
    );
    const sheet = screen.getByRole("dialog", { name: "Rà và giao 9 việc" });
    expect(sheet).toHaveClass("data-[side=right]:w-140", "rounded-l-lg");
    expect(document.querySelector("[data-slot='sheet-overlay']")).toHaveClass("bg-scrim");
    expect(screen.getByRole("button", { name: "Giao 9 việc" }).parentElement).toHaveClass("py-4", "border-t");
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks a 440 confirmation with a plain footer", () => {
    render(
      <Dialog440
        open
        onOpenChange={() => {}}
        role="alertdialog"
        title="Chốt biên bản?"
        description="Còn 9 việc chưa giao."
        footer={<button type="button">Chốt</button>}
      />,
    );
    const dialog = screen.getByRole("alertdialog", { name: "Chốt biên bản?" });
    expect(dialog).toHaveClass("rounded-lg", "p-6", "sm:max-w-110");
    expect(screen.getByText("Còn 9 việc chưa giao.")).toHaveClass("mt-2", "text-body-lg");
    expect(screen.getByRole("button", { name: "Chốt" }).parentElement).toHaveClass("mt-6", "justify-end");
    expect(document.querySelector("[data-slot='dialog-overlay']")).toHaveClass("bg-scrim");
  });
});
