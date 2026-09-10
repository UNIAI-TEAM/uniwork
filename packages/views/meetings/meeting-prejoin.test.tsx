import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types";
import { wrapWithNav } from "../test/api-mock";
import { MeetingPreJoin } from "./meeting-prejoin";

const meeting: Meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Standup",
  description: "",
  starts_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  ends_at: new Date(Date.now() + 90 * 60_000).toISOString(),
  room_name: "uw_mtg_m1",
  created_by: "u-host",
  status: "SCHEDULED",
  host_user_id: "u-host",
};

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: vi.fn().mockResolvedValue([
        { deviceId: "cam1", kind: "videoinput", label: "FaceTime HD" },
        { deviceId: "mic1", kind: "audioinput", label: "Built-in Mic" },
      ]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
});

describe("MeetingPreJoin", () => {
  it("shows meeting details, device pickers, and join choice", async () => {
    const onJoin = vi.fn();
    render(
      wrapWithNav(<MeetingPreJoin meeting={meeting} onJoin={onJoin} onLeave={() => {}} />),
    );

    expect(await screen.findByRole("heading", { name: "Standup" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Micro", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Camera", pressed: true })).toBeInTheDocument();
    expect(await screen.findByText("Built-in Mic")).toBeInTheDocument();
    expect(screen.getByText("FaceTime HD")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Micro", pressed: true }));
    fireEvent.click(screen.getByRole("button", { name: "Camera", pressed: true }));
    fireEvent.click(screen.getByRole("button", { name: "Vào phòng họp" }));

    expect(onJoin).toHaveBeenCalledWith({
      audio: false,
      video: false,
      audioDeviceId: undefined,
      videoDeviceId: undefined,
    });
  });

  it("falls back to the generic title when meeting metadata is missing", () => {
    render(wrapWithNav(<MeetingPreJoin onJoin={() => {}} onLeave={() => {}} />));
    expect(screen.getByRole("heading", { name: "Cuộc họp" })).toBeInTheDocument();
  });
});
