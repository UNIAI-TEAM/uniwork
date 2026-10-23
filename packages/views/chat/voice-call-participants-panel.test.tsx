import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { VoiceCallFloatingPanel } from "./voice-call-floating-panel";
import { useVoiceCallParticipantsPanel } from "./voice-call-participants-panel";
import { VoiceCallMediaContext } from "./voice-call-room-context";
import type { VoiceCallParticipantTile } from "./voice-call-room-types";

beforeAll(() => {
  initI18n();
});

const TILES: VoiceCallParticipantTile[] = [
  { identity: "u-me", name: "Quang", isLocal: true, hasVideo: true, hasScreenShare: false, micMuted: false },
  { identity: "u-minh", name: "Võ Minh", isLocal: false, hasVideo: true, hasScreenShare: true, isSpeaking: true },
  { identity: "u-lan", name: "  ", isLocal: false, hasVideo: false, hasScreenShare: false, micMuted: true },
];

function media(tiles: VoiceCallParticipantTile[]) {
  return {
    participantTiles: tiles,
    remoteCameraEnabled: false,
    remoteScreenShareEnabled: false,
    bindLocalVideo: vi.fn(),
    bindRemoteVideo: vi.fn(),
    bindLocalScreenShare: vi.fn(),
    bindRemoteScreenShare: vi.fn(),
    bindParticipantVideo: vi.fn(),
    bindParticipantScreenShare: vi.fn(),
  };
}

function FullscreenCall({ onMinimize }: { onMinimize: () => void }) {
  const participants = useVoiceCallParticipantsPanel();
  return (
    <VoiceCallFloatingPanel
      peerName="Ra mắt Q4"
      statusLabel="Đã kết nối"
      mode="fullscreen"
      onMinimize={onMinimize}
      fullscreenAction={participants.toggle}
      fullscreenAside={participants.panel}
    >
      <span>stage</span>
    </VoiceCallFloatingPanel>
  );
}

function renderCall(tiles = TILES) {
  const onMinimize = vi.fn();
  render(
    wrap(
      <VoiceCallMediaContext.Provider value={media(tiles)}>
        <FullscreenCall onMinimize={onMinimize} />
      </VoiceCallMediaContext.Provider>,
    ),
  );
  return { onMinimize };
}

describe("fullscreen participants panel", () => {
  it("opens from the header toggle, which carries the head count", async () => {
    renderCall();
    const dialog = await screen.findByRole("dialog", { name: "Ra mắt Q4" });
    const toggle = within(dialog).getByRole("button", { name: /Người tham gia/ });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveTextContent("3");
    expect(within(dialog).queryByRole("complementary")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    const panel = within(dialog).getByRole("complementary", { name: "Người tham gia (3)" });
    expect(toggle).toHaveAttribute("aria-controls", panel.id);
    // The stage stays beside it.
    expect(within(dialog).getByText("stage")).toBeInTheDocument();
  });

  it("lists each person with their name, speaking, mic and camera state", async () => {
    renderCall();
    fireEvent.click(await screen.findByRole("button", { name: /Người tham gia/ }));
    const rows = within(screen.getByRole("complementary")).getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    // The local person reads as "Bạn", with mic and camera on.
    expect(rows[0]).toHaveTextContent("Bạn");
    expect(within(rows[0]!).getByRole("img", { name: "Micro đang bật" })).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("img", { name: "Camera đang bật" })).toBeInTheDocument();
    expect(within(rows[0]!).queryByText("Đang nói")).toBeNull();

    expect(rows[1]).toHaveTextContent("Võ Minh");
    expect(within(rows[1]!).getByText("Đang nói")).toBeInTheDocument();

    // A blank name falls back to the identity, as on the stage tiles.
    expect(rows[2]).toHaveTextContent("u-lan");
    expect(within(rows[2]!).getByRole("img", { name: "Micro đang tắt" })).toBeInTheDocument();
    expect(within(rows[2]!).queryByRole("img", { name: "Camera đang bật" })).toBeNull();
  });

  it("closes from its X and hands focus back to the toggle", async () => {
    renderCall();
    const toggle = await screen.findByRole("button", { name: /Người tham gia/ });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Ẩn danh sách người tham gia" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveFocus();
  });

  it("leaves Escape to its one meaning: leave fullscreen, even with the panel open", async () => {
    const { onMinimize } = renderCall();
    const dialog = await screen.findByRole("dialog", { name: "Ra mắt Q4" });
    await waitFor(() => expect(within(dialog).getByLabelText("Thu về cửa sổ")).toHaveFocus());
    fireEvent.click(within(dialog).getByRole("button", { name: /Người tham gia/ }));
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    expect(onMinimize).toHaveBeenCalledTimes(1);
  });
});
