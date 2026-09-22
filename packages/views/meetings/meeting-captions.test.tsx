import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { MeetingCaptionsOverlay, useLiveCaptions } from "./meeting-captions";

beforeAll(() => {
  initI18n();
});

type FakeRecognition = {
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

let instances: FakeRecognition[] = [];

function installRecognition() {
  instances = [];
  class Rec {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult = null;
    onend = null;
    onerror: FakeRecognition["onerror"] = null;
    start = vi.fn();
    stop = vi.fn();
    constructor() {
      instances.push(this);
    }
  }
  (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = Rec;
}

afterEach(() => {
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

const wrapper = ({ children }: { children: ReactNode }) => wrap(<>{children}</>);

describe("MeetingCaptionsOverlay", () => {
  it("says the captions are automatic and only carry the viewer's own voice", () => {
    render(<MeetingCaptionsOverlay interim="" lastFinal="" />);
    expect(screen.getByText("Phụ đề tự động · chỉ giọng của bạn")).toBeInTheDocument();
  });

  it("announces finished sentences only, never the interim words", () => {
    render(<MeetingCaptionsOverlay interim="chốt lịch ph" lastFinal="Chúng ta họp lúc chín giờ." />);
    const live = screen.getByRole("status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("Chúng ta họp lúc chín giờ.");
    expect(live).not.toHaveTextContent("chốt lịch ph");
  });
});

describe("useLiveCaptions", () => {
  it("reports a blocked microphone once instead of listening forever", () => {
    installRecognition();
    const onError = vi.fn();
    renderHook(() => useLiveCaptions("m1", true, onError), { wrapper });
    expect(instances).toHaveLength(1);

    act(() => instances[0]!.onerror?.({ error: "no-speech" }));
    expect(onError).not.toHaveBeenCalled();

    act(() => instances[0]!.onerror?.({ error: "not-allowed" }));
    expect(onError).toHaveBeenCalledWith("not-allowed");
  });

  it("reports an unsupported browser", () => {
    const onError = vi.fn();
    renderHook(() => useLiveCaptions("m1", true, onError), { wrapper });
    expect(onError).toHaveBeenCalledWith("unsupported");
  });
});
