import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { DESKTOP_PLATFORMS, DESKTOP_INSTALLER_KINDS, type DesktopPlatform, type OfficeInstallerOption } from "@uniwork/core/office";
import { OfficeInstallPrompt, type OfficeInstallPromptProps } from "./install-prompt";

initI18n();
function option(platform: DesktopPlatform): OfficeInstallerOption {
  return { platform, kind: DESKTOP_INSTALLER_KINDS[platform].kind, url: `https://downloads.test/Office_0.1.0-dev.1_unsigned_${platform}${DESKTOP_INSTALLER_KINDS[platform].kind}`,
    channel: "dev", unsigned: true, version: "0.1.0-dev.1", size_bytes: 142 * 1048576 };
}
function props(overrides: Partial<OfficeInstallPromptProps> = {}): OfficeInstallPromptProps {
  return { open: true, channel: "dev", installers: DESKTOP_PLATFORMS.map(option), platformHint: { platform: "win32-x64", confidence: "certain" },
    onOpenChange: vi.fn(), onOpenAgain: vi.fn(), reason: "download", onDownload: vi.fn(async () => undefined), ...overrides };
}
beforeEach(async () => { await setLocale("en"); });

describe("OfficeInstallPrompt", () => {
  it.each([
    ["win32-x64", "Windows", "x64 · .exe"], ["darwin-arm64", "macOS", "Apple Silicon · .dmg"],
    ["darwin-x64", "macOS", "Intel · .dmg"], ["linux-x64-deb", "Linux", ".deb"],
  ] as const)("recommends %s and focuses the matching download action", async (platform, os, chip) => {
    render(<OfficeInstallPrompt {...props({ platformHint: { platform, confidence: "certain" } })} />);
    expect(screen.getByRole("radio", { name: os })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: chip })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: `Download for ${os}` })).toHaveFocus());
  });
  it("keeps both Mac chips and help when the architecture is uncertain", () => {
    render(<OfficeInstallPrompt {...props({ platformHint: { platform: "darwin-arm64", confidence: "uncertain" } })} />);
    expect(screen.getByRole("radio", { name: "Apple Silicon · .dmg" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Intel · .dmg" })).toBeInTheDocument();
    expect(screen.getByText(/Not sure which chip/)).toBeInTheDocument();
  });
  it("allows another computer's build without warnings and resets each OS to its first chip", async () => {
    const onDownload = vi.fn(async () => undefined);
    render(<OfficeInstallPrompt {...props({ onDownload })} />);
    fireEvent.click(screen.getByRole("radio", { name: "macOS" }));
    fireEvent.click(screen.getByRole("radio", { name: "Intel · .dmg" }));
    fireEvent.click(screen.getByRole("button", { name: "Download for macOS" }));
    await waitFor(() => expect(onDownload).toHaveBeenCalledWith("darwin-x64"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "After downloading" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Windows" }));
    expect(screen.getByRole("button", { name: "After downloading" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("radio", { name: "x64 · .exe" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/Download started:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "macOS" }));
    expect(screen.getByRole("radio", { name: "Apple Silicon · .dmg" })).toHaveAttribute("aria-checked", "true");
  });
  it("shows unsupported devices without a recommendation and selects the first supported build", () => {
    render(<OfficeInstallPrompt {...props({ platformHint: { platform: null, confidence: "unsupported" } })} />);
    expect(screen.getByText(/doesn't support this device/)).toBeInTheDocument();
    expect(screen.queryByText("Recommended")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Windows" })).toHaveAttribute("aria-checked", "true");
  });
  it("shows a supported OS with no channel artifact as an unavailable selectable card", () => {
    render(<OfficeInstallPrompt {...props({ installers: [option("win32-x64")], platformHint: { platform: "darwin-arm64", confidence: "uncertain" } })} />);
    expect(screen.getByRole("radio", { name: "macOS" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("No macOS installer is available yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download for macOS" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Windows" }));
    expect(screen.getByRole("button", { name: "Download for Windows" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "macOS" }));
    expect(screen.getByText("No macOS installer is available yet.")).toBeInTheDocument();
  });
  it("changes cards and chips with supported data and keeps a single chip visible", () => {
    const p = props({ installers: [option("linux-x64-appimage")], supportedPlatforms: ["linux-x64-appimage"] });
    render(<OfficeInstallPrompt {...p} />);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryByRole("radio", { name: "Windows" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: ".deb" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: ".AppImage" })).toHaveAttribute("aria-checked", "true");
  });
  it("does not display unknown keys or dev artifacts in stable; an empty channel only offers Not now", async () => {
    const p = props({ channel: "stable", installers: [...DESKTOP_PLATFORMS.map(option), { ...option("win32-x64"), platform: "unknown" } as unknown as OfficeInstallerOption], reason: "error" });
    const view = render(<OfficeInstallPrompt {...p} />);
    expect(screen.getByText("Install link unavailable")).toBeInTheDocument();
    // A status line, not a bordered field-like box.
    expect(screen.getByText("Install link unavailable").closest("[data-slot=alert]")).toBeNull();
    expect(screen.getByText("Install link unavailable")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open again" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Not now" })).toHaveFocus());
    view.rerender(<OfficeInstallPrompt {...p} reason="download" />);
    expect(screen.getByText("The desktop installer isn't available yet. Try again later.")).toBeInTheDocument();
    expect(screen.queryByText("Choose the operating system and format that fits your computer.")).not.toBeInTheDocument();
  });
  it("keeps the download live region rendered, collapsed not display:none, so the later text is announced", () => {
    render(<OfficeInstallPrompt {...props()} />);
    const region = document.querySelector<HTMLElement>('p[role="status"]');
    expect(region).not.toBeNull();
    expect(region).toBeEmptyDOMElement();
    expect(region!.className).toContain("empty:sr-only");
    expect(region!.className).not.toContain("empty:hidden");
  });
  it("locks both groups while downloading, reports success and opens the instructions", async () => {
    let finish!: () => void;
    const onDownload = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<OfficeInstallPrompt {...props({ onDownload })} />);
    fireEvent.click(screen.getByRole("button", { name: "Download for Windows" }));
    expect(screen.getByRole("button", { name: "Downloading…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Linux" }));
    expect(screen.getByRole("radio", { name: "Windows" })).toHaveAttribute("aria-checked", "true");
    finish();
    await screen.findByText(/Download started:/);
    expect(screen.getByText("UniWork-Office.zip")).toBeInTheDocument();
    // The note takes its own row above the buttons instead of wrapping beside them.
    const note = screen.getByText(/Download started:/);
    expect(note.querySelector("button")).toBeNull();
    expect(note.nextElementSibling).toContainElement(screen.getByRole("button", { name: "Not now" }));
    expect(screen.getByRole("button", { name: "After downloading" })).toHaveAttribute("aria-expanded", "true");
  });
  it("keeps the selected artifact on download failure and retries it", async () => {
    const onDownload = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(undefined);
    render(<OfficeInstallPrompt {...props({ onDownload })} />);
    fireEvent.click(screen.getByRole("button", { name: "Download for Windows" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Download failed");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText(/Download started:/);
    expect(onDownload).toHaveBeenNthCalledWith(2, "win32-x64");
  });
  it("navigates OS and chip choices with arrow keys", async () => {
    const user = userEvent.setup();
    render(<OfficeInstallPrompt {...props()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Download for Windows" })).toHaveFocus());
    const windows = screen.getByRole("radio", { name: "Windows" });
    windows.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("radio", { name: "macOS" })).toHaveAttribute("aria-checked", "true"));
    screen.getByRole("radio", { name: "Apple Silicon · .dmg" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Intel · .dmg" })).toHaveAttribute("aria-checked", "true");
  });
  it.each([
    ["win32-x64", /Run Office_/, /More info/], ["win32-x64-zip", /Extract Office_/, /uniwork-office/],
    ["darwin-arm64", /Extract the ZIP.*open Office_/, /Applications/], ["darwin-x64", /Extract the ZIP.*open Office_/, /Applications/],
    ["linux-x64-deb", /App Center/, /gnome-keyring/], ["linux-x64-appimage", /executable/, /libfuse2/],
  ] as const)("shows the selected %s instructions", async (platform, first, second) => {
    render(<OfficeInstallPrompt {...props({ platformHint: { platform, confidence: "certain" } })} />);
    fireEvent.click(screen.getByRole("button", { name: "After downloading" }));
    const list = await screen.findByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText(first)).toBeInTheDocument();
    expect(within(list).getAllByText(second).length).toBeGreaterThan(0);
  });
  it("resets the artifact, guide and status when the dialog opens again", async () => {
    const p = props();
    const view = render(<OfficeInstallPrompt {...p} />);
    fireEvent.click(screen.getByRole("radio", { name: "macOS" }));
    fireEvent.click(screen.getByRole("button", { name: "Download for macOS" }));
    await screen.findByText(/Download started:/);
    view.rerender(<OfficeInstallPrompt {...p} open={false} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    view.rerender(<OfficeInstallPrompt {...p} />);
    expect(screen.getByRole("radio", { name: "Windows" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "After downloading" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Download started:/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Download for Windows" })).toHaveFocus());
  });
  it("uses server requirements and metadata, hides absent size, and copies the actual safe command", async () => {
    const item = { ...option("linux-x64-deb"), requirements: "Ubuntu 24.04 only", size_bytes: undefined, url: "https://downloads.test/a%20file.deb" };
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<OfficeInstallPrompt {...props({ installers: [item], platformHint: { platform: item.platform, confidence: "certain" } })} />);
    expect(screen.getByText("Ubuntu 24.04 only")).toBeInTheDocument();
    expect(screen.queryByText(/Size:/)).not.toBeInTheDocument();
    expect(screen.getByText(/Version 0.1.0-dev.1/)).toBeInTheDocument();
    expect(screen.getByText("unsigned")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "After downloading" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy command" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("sudo apt install ./'a file.deb'"));
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
