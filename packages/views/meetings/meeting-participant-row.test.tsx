"use client";

import type { Participant } from "livekit-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingParticipantRow } from "./meeting-participant-row";

beforeAll(() => {
  initI18n();
});

const livekit = vi.hoisted(() => ({ muted: false, speaking: false }));

vi.mock("@livekit/components-react", () => ({
  useIsSpeaking: () => livekit.speaking,
  useIsMuted: () => livekit.muted,
}));

vi.mock("./use-meeting-signals", () => ({
  useRequestMute: () => vi.fn(),
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
    on: vi.fn(),
    off: vi.fn(),
    ...overrides,
  } as Participant;
}

describe("MeetingParticipantRow", () => {
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

  it("shows an open mic as a quiet state, beside nothing louder", () => {
    render(<MeetingParticipantRow participant={fakeParticipant()} />);
    expect(screen.getByRole("img", { name: "Mic đang bật" })).toHaveClass("text-faint-foreground");
    expect(screen.queryByRole("img", { name: "Mic đang tắt" })).not.toBeInTheDocument();
  });

  it("draws the secretary chip quiet in the room", () => {
    render(<MeetingParticipantRow participant={fakeParticipant()} roleChip="secretary" />);
    expect(screen.getByText("Thư ký")).toHaveClass("bg-surface-hover", "text-muted-foreground");
    expect(screen.getByText("Thư ký")).not.toHaveClass("bg-brand-subtle");
  });

  it("marks a secretary and an observer beside the name", () => {
    const { rerender } = render(<MeetingParticipantRow participant={fakeParticipant()} roleChip="secretary" />);
    expect(screen.getByText("Thư ký")).toBeInTheDocument();
    rerender(<MeetingParticipantRow participant={fakeParticipant()} roleChip="observer" />);
    expect(screen.getByText("Dự thính")).toBeInTheDocument();
  });

  it("appends the caller's extra menu entries", async () => {
    render(<MeetingParticipantRow participant={fakeParticipant()} menuExtra={<li role="menuitem">Giao vai thư ký</li>} />);
    fireEvent.click(screen.getByRole("button", { name: /Thao tác với Guest One/i }));
    expect(await screen.findByRole("menuitem", { name: "Giao vai thư ký" })).toBeInTheDocument();
  });
  it("marks you with a faint word, not a suffix on your name", () => {
    render(<MeetingParticipantRow participant={fakeParticipant({ isLocal: true, name: "Lan" })} />);
    expect(screen.getByText("Lan")).toBeInTheDocument();
    expect(screen.getByText("bạn")).toHaveClass("text-faint-foreground");
    expect(screen.queryByText(/\(Bạn\)/)).not.toBeInTheDocument();
  });

  it("shows the host and the room mic as chips", () => {
    render(<MeetingParticipantRow participant={fakeParticipant()} host sharedMic roleChip="secretary" />);
    expect(screen.getByText("Chủ trì")).toHaveClass("bg-brand-subtle");
    expect(screen.getByText("Mic hội trường")).toHaveClass("bg-tint-violet");
    expect(screen.getByText("Thư ký")).toBeInTheDocument();
  });

  it("rings a speaker's face and shows a muted mic in red", () => {
    livekit.speaking = true;
    try {
      const { container } = render(<MeetingParticipantRow participant={fakeParticipant()} />);
      expect(container.querySelector('[data-slot="avatar"]')).toHaveClass("ring-2", "ring-success/60");
      expect(screen.getByRole("img", { name: "Đang nói" })).toBeInTheDocument();
    } finally {
      livekit.speaking = false;
    }
    livekit.muted = true;
    try {
      render(<MeetingParticipantRow participant={fakeParticipant({ identity: "uw_participant_p2" })} />);
      expect(screen.getByRole("img", { name: "Mic đang tắt" })).toHaveClass("text-destructive");
    } finally {
      livekit.muted = false;
    }
  });
});
