import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { VoiceCallRecordingPlayer } from "./voice-call-recording-player";

beforeAll(() => {
  initI18n();
});

describe("VoiceCallRecordingPlayer", () => {
  it("names every control, so the keyboard drives it like the native one", () => {
    render(wrap(<VoiceCallRecordingPlayer src="https://x/rec.mp4" onError={vi.fn()} />));
    expect(screen.getByRole("button", { name: "Phát" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Tua bản ghi" })).toHaveAttribute("aria-valuetext", "0:00 trên 0:00");
    expect(screen.getByRole("slider", { name: "Âm lượng" })).toHaveValue("100");
    expect(screen.getByRole("button", { name: "Tắt tiếng" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toàn màn hình" })).toBeInTheDocument();
  });

  it("mutes the video from the sound button and reports a load failure", () => {
    const onError = vi.fn();
    const { container } = render(wrap(<VoiceCallRecordingPlayer src="https://x/rec.mp4" onError={onError} />));
    const video = container.querySelector("video")!;
    fireEvent.click(screen.getByRole("button", { name: "Tắt tiếng" }));
    expect(video.muted).toBe(true);
    fireEvent.error(video);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
