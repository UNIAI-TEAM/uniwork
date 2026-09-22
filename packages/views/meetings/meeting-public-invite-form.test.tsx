import { render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { MeetingPublicInviteForm } from "./meeting-public-invite-form";

beforeAll(() => {
  initI18n();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderForm() {
  return render(
    wrap(
      <MeetingPublicInviteForm
        title="Standup"
        startsAt="2026-09-10T02:00:00Z"
        accessMode="AUTO_ADMIT"
        displayName=""
        onDisplayNameChange={() => undefined}
        joinPending={false}
        onJoin={() => undefined}
        onLogin={() => undefined}
      />,
    ),
  );
}

function stubPointer(fine: boolean) {
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) =>
    query === "(pointer: fine)" ? ({ ...real(query), matches: fine } as MediaQueryList) : real(query),
  );
}

describe("MeetingPublicInviteForm", () => {
  it("focuses the name field for a mouse or trackpad", () => {
    stubPointer(true);
    renderForm();
    expect(screen.getByLabelText("Tên hiển thị")).toHaveFocus();
  });

  it("leaves focus alone on touch, so the phone keyboard does not cover the page", () => {
    stubPointer(false);
    renderForm();
    expect(screen.getByLabelText("Tên hiển thị")).not.toHaveFocus();
    expect(screen.getByLabelText("Tên hiển thị")).toHaveAttribute("autocomplete", "name");
  });

  it("shows no device pickers before the browser names any device", () => {
    stubPointer(false);
    renderForm();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("offers a mic picker once the browser lists a microphone", async () => {
    stubPointer(false);
    const devices = [{ kind: "audioinput", deviceId: "mic-1", label: "USB Mic", groupId: "g" }];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue(devices),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    try {
      renderForm();
      expect(await screen.findByLabelText("Micro")).toBeInTheDocument();
      expect(screen.queryByLabelText("Camera", { selector: "[id='guest-camera']" })).not.toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });
});
