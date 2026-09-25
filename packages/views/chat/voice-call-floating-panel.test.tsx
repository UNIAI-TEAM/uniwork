import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import {
  VoiceCallControlRow,
  VoiceCallFloatingPanel,
  VoiceCallLabeledAction,
  voiceCallInitialOf,
} from "./voice-call-floating-panel";

beforeAll(() => {
  initI18n();
});

describe("voiceCallInitialOf", () => {
  it("uses the one-letter fallback every chat avatar uses", () => {
    expect(voiceCallInitialOf("Tran Hoang Long")).toBe("T");
  });

  it("falls back to first character for single token names", () => {
    expect(voiceCallInitialOf("alice")).toBe("A");
  });

  it("returns question mark for empty names", () => {
    expect(voiceCallInitialOf("   ")).toBe("?");
  });
});

describe("VoiceCallFloatingPanel", () => {
  it("renders expanded panel with minimize and fullscreen controls", () => {
    const onMinimize = vi.fn();
    const onMaximize = vi.fn();
    render(
      wrap(
        <VoiceCallFloatingPanel
          peerName="Long"
          statusLabel="Calling…"
          mode="expanded"
          onMinimize={onMinimize}
          onMaximize={onMaximize}
          footer={<span>footer</span>}
        >
          <span>body</span>
        </VoiceCallFloatingPanel>,
      ),
    );

    expect(screen.getByText("Long")).toBeInTheDocument();
    expect(screen.getByText("Calling…")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Thu nhỏ cuộc gọi"));
    expect(onMinimize).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Phóng to toàn màn hình"));
    expect(onMaximize).toHaveBeenCalledTimes(1);
  });

  it("renders minimized chip with expand control", () => {
    const onMaximize = vi.fn();
    render(
      wrap(
        <VoiceCallFloatingPanel
          peerName="Team"
          statusLabel="00:12"
          mode="minimized"
          onMaximize={onMaximize}
        />,
      ),
    );

    fireEvent.click(screen.getByLabelText("Mở rộng cuộc gọi"));
    expect(onMaximize).toHaveBeenCalledTimes(1);
  });

  it("renders fullscreen panel with restore control", () => {
    const onMinimize = vi.fn();
    render(
      wrap(
        <VoiceCallFloatingPanel
          peerName="Long"
          statusLabel="Connected · 00:12"
          mode="fullscreen"
          onMinimize={onMinimize}
          footer={<span>controls</span>}
        >
          <span>video</span>
        </VoiceCallFloatingPanel>,
      ),
    );

    expect(screen.getByText("video")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Thu về cửa sổ"));
    expect(onMinimize).toHaveBeenCalledTimes(1);
  });
});

describe("VoiceCallFloatingPanel focus", () => {
  function Harness({ mode, onMinimize, onMaximize }: { mode: "expanded" | "minimized"; onMinimize: () => void; onMaximize: () => void }) {
    return (
      <VoiceCallFloatingPanel
        peerName="Long"
        statusLabel="Đã kết nối"
        mode={mode}
        onMinimize={onMinimize}
        onMaximize={onMaximize}
      >
        <span>body</span>
      </VoiceCallFloatingPanel>
    );
  }

  it("moves focus to the control that undoes a minimise or expand", () => {
    const props = { onMinimize: vi.fn(), onMaximize: vi.fn() };
    const { rerender } = render(wrap(<Harness mode="expanded" {...props} />));
    expect(screen.getByRole("region", { name: "Cuộc gọi với Long · Đã kết nối" })).toBeInTheDocument();

    rerender(wrap(<Harness mode="minimized" {...props} />));
    expect(screen.getByLabelText("Mở rộng cuộc gọi")).toHaveFocus();

    rerender(wrap(<Harness mode="expanded" {...props} />));
    expect(screen.getByLabelText("Thu nhỏ cuộc gọi")).toHaveFocus();
  });

  it("keeps the recording badge on the minimised pill", () => {
    render(
      wrap(
        <VoiceCallFloatingPanel
          peerName="Long"
          statusLabel="Đã kết nối"
          mode="minimized"
          indicator={<span data-testid="rec">REC</span>}
        />,
      ),
    );
    expect(screen.getByTestId("rec")).toBeInTheDocument();
  });
});

describe("VoiceCallLabeledAction", () => {
  it("invokes onClick from labeled action button", () => {
    const onClick = vi.fn();
    render(
      wrap(
        <VoiceCallControlRow>
          <VoiceCallLabeledAction
            label="Accept"
            ariaLabel="Accept call"
            tone="accept"
            onClick={onClick}
            icon={<span aria-hidden>X</span>}
          />
        </VoiceCallControlRow>,
      ),
    );

    fireEvent.click(screen.getByLabelText("Accept call"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
