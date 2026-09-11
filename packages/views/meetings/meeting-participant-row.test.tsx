"use client";

import type { Participant } from "livekit-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingParticipantRow } from "./meeting-participant-row";

beforeAll(() => {
  initI18n();
});

vi.mock("@livekit/components-react", () => ({
  useIsSpeaking: () => false,
  useIsMuted: () => false,
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
});
