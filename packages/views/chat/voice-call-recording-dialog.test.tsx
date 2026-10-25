import { render, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { VoiceCallRecordingDialog } from "./voice-call-recording-dialog";

const resolvePlayback = vi.fn();

vi.mock("@uniwork/core/api/endpoints/chat-voice", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/chat-voice")>()),
  resolveChatVoiceRecordingPlayback: (...args: unknown[]) => resolvePlayback(...args),
  loadChatVoiceRecordingBlob: vi.fn(),
}));

beforeAll(() => {
  initI18n();
});

describe("VoiceCallRecordingDialog", () => {
  it("revokes blob playback when the dialog closes", async () => {
    const revoke = vi.fn<(url: string) => void>();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:recording",
      revokeObjectURL: revoke,
    });

    resolvePlayback.mockResolvedValue({ kind: "blob", url: "blob:recording" });

    const { rerender } = render(
      wrap(
        <VoiceCallRecordingDialog
          open
          onOpenChange={() => {}}
          workspaceId="ws1"
          roomId="room1"
          recordingId="rec1"
        />,
      ),
    );

    await waitFor(() => expect(resolvePlayback).toHaveBeenCalled());

    rerender(
      wrap(
        <VoiceCallRecordingDialog
          open={false}
          onOpenChange={() => {}}
          workspaceId="ws1"
          roomId="room1"
          recordingId="rec1"
        />,
      ),
    );

    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:recording"));

    vi.unstubAllGlobals();
    resolvePlayback.mockReset();
  });
});
