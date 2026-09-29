import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MeetingDevicesDialog } from "./meeting-devices-dialog";

vi.mock("@livekit/components-react", () => ({
  useRoomContext: () => ({ switchActiveDevice: vi.fn() }),
  useLocalParticipant: () => ({ isCameraEnabled: false }),
  useMediaDeviceSelect: () => ({ devices: [], activeDeviceId: "", setActiveMediaDevice: vi.fn() }),
}));
vi.mock("./meeting-camera-preview", () => ({ MeetingCameraPreview: () => <div data-testid="preview" /> }));

beforeAll(() => {
  initI18n();
});

describe("MeetingDevicesDialog", () => {
  function open() {
    render(<MeetingDevicesDialog open onOpenChange={() => {}} trigger={null} />);
  }

  it("names its close button in the viewer's language", () => {
    open();
    expect(screen.getByRole("button", { name: "Đóng" })).toBeInTheDocument();
  });

  it("puts the devices before the switches, so a phone and the first Tab reach them first", () => {
    open();
    const reload = screen.getByRole("button", { name: /Tải lại/ });
    const mirror = screen.getByRole("switch", { name: /Lật ngang hình của bạn/ });
    expect(reload.compareDocumentPosition(mirror) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
