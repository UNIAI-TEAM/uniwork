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
  it("uses first letters of first and last name", () => {
    expect(voiceCallInitialOf("Tran Hoang Long")).toBe("TL");
  });

  it("falls back to first character for single token names", () => {
    expect(voiceCallInitialOf("alice")).toBe("A");
  });

  it("returns question mark for empty names", () => {
    expect(voiceCallInitialOf("   ")).toBe("?");
  });
});

describe("VoiceCallFloatingPanel", () => {
  it("renders expanded panel with minimize control", () => {
    const onToggleMode = vi.fn();
    render(
      wrap(
        <VoiceCallFloatingPanel
          peerName="Long"
          statusLabel="Calling…"
          mode="expanded"
          onToggleMode={onToggleMode}
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
    expect(onToggleMode).toHaveBeenCalledTimes(1);
  });

  it("renders minimized chip with expand control", () => {
    const onToggleMode = vi.fn();
    render(
      wrap(
        <VoiceCallFloatingPanel
          peerName="Team"
          statusLabel="00:12"
          mode="minimized"
          onToggleMode={onToggleMode}
        />,
      ),
    );

    fireEvent.click(screen.getByLabelText("Mở rộng cuộc gọi"));
    expect(onToggleMode).toHaveBeenCalledTimes(1);
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
