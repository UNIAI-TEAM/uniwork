import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { MeetingCaptionsOverlay, useLiveCaptions } from "./meeting-captions";

beforeAll(() => {
  initI18n();
});

type FakeResult = { isFinal: boolean; 0: { transcript: string } };
type FakeRecognition = {
  onresult: ((e: { resultIndex: number; results: FakeResult[] }) => void) | null;
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
    onresult: FakeRecognition["onresult"] = null;
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

  it("says captions are paused while the microphone is off", () => {
    render(<MeetingCaptionsOverlay interim="" lastFinal="Câu cũ." paused />);
    expect(screen.getByRole("status")).toHaveTextContent("Phụ đề tạm dừng khi tắt mic");
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

  it("does not listen while the room microphone is off", () => {
    installRecognition();
    renderHook(() => useLiveCaptions("m1", true, vi.fn(), false), { wrapper });
    expect(instances).toHaveLength(0);
  });

  it("stops listening on mute and never posts a sentence heard after it", () => {
    installRecognition();
    requestMock.mockReset();
    requestMock.mockResolvedValue({});
    const { rerender } = renderHook(({ micOn }) => useLiveCaptions("m1", true, vi.fn(), micOn), {
      wrapper,
      initialProps: { micOn: true },
    });
    const rec = instances[0]!;
    rerender({ micOn: false });
    expect(rec.stop).toHaveBeenCalled();

    act(() => rec.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "bí mật" } }] }));
    expect(requestMock).not.toHaveBeenCalled();

    rerender({ micOn: true });
    expect(instances).toHaveLength(2);
  });

  it("reports an unsupported browser", () => {
    const onError = vi.fn();
    renderHook(() => useLiveCaptions("m1", true, onError), { wrapper });
    expect(onError).toHaveBeenCalledWith("unsupported");
  });
});
