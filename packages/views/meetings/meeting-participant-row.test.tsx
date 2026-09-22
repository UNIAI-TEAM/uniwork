"use client";

import type { Participant } from "livekit-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingParticipantRow } from "./meeting-participant-row";

beforeAll(() => {
  initI18n();
});

const livekit = vi.hoisted(() => ({ muted: false }));

vi.mock("@livekit/components-react", () => ({
  useIsSpeaking: () => false,
  useIsMuted: () => livekit.muted,
}));

vi.mock("./use-meeting-signals", () => ({
  useMeetingSignals: () => ({ requestMute: vi.fn() }),
}));

vi.mock("@uniwork/core/meetings/view-session", () => ({
  useMeetingViewSessionStore: (sel: (s: { pinParticipant: () => void; toggleHidden: () => void; isHidden: () => boolean }) => unknown) =>
    sel({
      pinParticipant: vi.fn(),
      toggleHidden: vi.fn(),
      isHidden: () => false,
    }),
}));

function fakeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    identity: "uw_participant_p1",
    name: "Guest One",
    isLocal: false,
    ...overrides,
  } as Participant;
}

describe("MeetingParticipantRow", () => {
  it("calls onRevokeSpeaking when host chooses hard mute", () => {
    const onRevokeSpeaking = vi.fn();
    render(
      <MeetingParticipantRow
        participant={fakeParticipant()}
        canHost
        onRevokeSpeaking={onRevokeSpeaking}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Thao tác với Guest One/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Không cho phép nói \(host\)/i }));
    expect(onRevokeSpeaking).toHaveBeenCalledOnce();
  });

  it("renders uppercase initials, or the photo when an avatar URL is known", () => {
    const { container, rerender } = render(<MeetingParticipantRow participant={fakeParticipant()} />);
    expect(screen.getByText("GO")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();

    rerender(
      <MeetingParticipantRow participant={fakeParticipant()} avatarUrl="https://cdn.test/guest.png" />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn.test/guest.png");
  });

  it("describes a muted mic as a state, not an action", () => {
    livekit.muted = true;
    try {
      render(<MeetingParticipantRow participant={fakeParticipant()} />);
      expect(screen.getByRole("img", { name: "Mic đang tắt" })).toBeInTheDocument();
    } finally {
      livekit.muted = false;
    }
  });

  it("keeps the actions button visible on touch screens and when focused", () => {
    render(<MeetingParticipantRow participant={fakeParticipant()} />);
    const trigger = screen.getByRole("button", { name: /Thao tác với Guest One/i });
    expect(trigger.className).toMatch(/pointer-coarse:opacity-100/);
    expect(trigger.className).toMatch(/focus-visible:opacity-100/);
  });

  it("marks a guest and an agent with a role chip beside the name", () => {
    const { rerender } = render(<MeetingParticipantRow participant={fakeParticipant()} roleChip="guest" />);
    expect(screen.getByText("Khách")).toBeInTheDocument();

    rerender(<MeetingParticipantRow participant={fakeParticipant({ name: "Trợ lý ghi chép" })} roleChip="agent" />);
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.queryByText("Khách")).not.toBeInTheDocument();

    rerender(<MeetingParticipantRow participant={fakeParticipant()} />);
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
  });
});
