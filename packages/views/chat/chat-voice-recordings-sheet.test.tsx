import { render, screen } from "@testing-library/react";
import { getI18n } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { requestMock, wrap } from "../test/api-mock";
import {
  ChatVoiceRecordingsSheet,
  recordingDurationSeconds,
  recordingStatus,
} from "./chat-voice-recordings-sheet";

const user = {
  id: "u1",
  email: "a@b.co",
  display_name: "A",
  onboarded_at: null,
  email_verified_at: null,
  onboarding_questionnaire: {},
  locale: "vi",
  has_password: true,
};

const t = (key: string) => getI18n().t(key);

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(user);
});

describe("recording helpers", () => {
  it("maps statuses case-insensitively and anything new to unknown", () => {
    expect(recordingStatus("COMPLETE")).toBe("complete");
    expect(recordingStatus("processing")).toBe("processing");
    expect(recordingStatus("ARCHIVED")).toBe("unknown");
  });

  it("measures only finished recordings", () => {
    expect(
      recordingDurationSeconds({ started_at: "2026-09-21T01:00:00Z", ended_at: "2026-09-21T01:03:05Z" }),
    ).toBe(185);
    expect(recordingDurationSeconds({ started_at: "2026-09-21T01:00:00Z", ended_at: "" })).toBeNull();
  });
});

describe("ChatVoiceRecordingsSheet", () => {
  it("never prints a raw server status and offers Play only on finished recordings", async () => {
    requestMock.mockResolvedValue({
      recordings: [
        { id: "r1", status: "COMPLETE", started_by: "u1", started_at: "2026-09-21T01:00:00Z", ended_at: "2026-09-21T01:03:05Z" },
        { id: "r2", status: "ARCHIVED", started_by: "u2", started_at: "2026-09-20T01:00:00Z", ended_at: "" },
      ],
    });
    render(
      wrap(
        <ChatVoiceRecordingsSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          roomId="room1"
          currentUserId="u1"
          nameContext={[]}
        />,
      ),
    );

    expect(await screen.findByText(t("chat.voice_recordings_status_complete"))).toHaveAttribute(
      "data-status",
      "complete",
    );
    expect(screen.queryByText("ARCHIVED")).not.toBeInTheDocument();
    expect(document.querySelector('[data-status="unknown"]')).not.toBeNull();
    const play = screen.getAllByRole("button", { name: t("chat.voice_recordings_play") });
    expect(play).toHaveLength(1);
    // Several "Play" buttons read the same; each is described by its row's time and author.
    expect(play[0]).toHaveAccessibleDescription(/Ghi bởi/);
  });
});
