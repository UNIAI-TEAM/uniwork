import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { DesktopPlatformGuess, OfficeLaunchOptions, OfficeLaunchOutcome } from "@uniwork/core/office";
import { OfficeHomeLaunch, type OfficeHomeLaunchProps } from "./office-home-launch";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

const windows: DesktopPlatformGuess = { platform: "win32-x64", confidence: "certain" };

function props(over: Partial<OfficeHomeLaunchProps> = {}): OfficeHomeLaunchProps {
  return {
    channel: "stable",
    launch: vi.fn(async (): Promise<OfficeLaunchOutcome> => "launched"),
    loadInstallers: vi.fn(async () => ({ installers: [] })),
    loadPlatformHint: vi.fn(async () => windows),
    downloadInstaller: vi.fn(async () => "UniWork-Office.exe"),
    ...over,
  };
}

describe("OfficeHomeLaunch", () => {
  it("opens the app's own scheme with no ticket and no document", async () => {
    const p = props();
    render(<OfficeHomeLaunch {...p} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open UniWork Office" }));
    await waitFor(() => expect(p.launch).toHaveBeenCalledWith("uniwork-office://home", expect.anything()));
    expect(p.loadInstallers).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses the dev scheme on the dev channel", async () => {
    const p = props({ channel: "dev" });
    render(<OfficeHomeLaunch {...p} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open UniWork Office" }));
    await waitFor(() => expect(p.launch).toHaveBeenCalledWith("uniwork-office-dev://home", expect.anything()));
  });

  it("carries the public deployment profile on the home link", async () => {
    const p = props({ channel: "dev", deploymentId: "dev-deploy", apiOrigin: "https://dev.uniwork.test" });
    render(<OfficeHomeLaunch {...p} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open UniWork Office" }));
    await waitFor(() => expect(p.launch).toHaveBeenCalledWith("uniwork-office-dev://home?deploymentId=dev-deploy&apiOrigin=https%3A%2F%2Fdev.uniwork.test&clientId=uniwork-office-dev&channel=dev", expect.anything()));
  });

  it("falls back to the installer dialog when the app does not answer, and Open again launches again", async () => {
    const launch = vi.fn(async (): Promise<OfficeLaunchOutcome> => "not-installed");
    const installer = { platform: "win32-x64" as const, kind: ".exe", url: "https://downloads.test/UniWork-Office.exe", channel: "stable" as const };
    const p = props({ launch, loadInstallers: vi.fn(async () => ({ installers: [installer] })) });
    render(<OfficeHomeLaunch {...p} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open UniWork Office" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(p.loadInstallers).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Open again" }));
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
  });

  it("closes the installer dialog by itself when the app hands off late (UNI-1649)", async () => {
    let late: (() => void) | undefined;
    const launch = vi.fn(async (_url: string, options?: OfficeLaunchOptions): Promise<OfficeLaunchOutcome> => { late = options?.onLateHandoff; return "not-installed"; });
    render(<OfficeHomeLaunch {...props({ launch })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open UniWork Office" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    act(() => late?.());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("never opens the installer dialog when the hand-off lands while the installers load (UNI-1649)", async () => {
    let late: (() => void) | undefined;
    let release: () => void = () => undefined;
    const launch = vi.fn(async (_url: string, options?: OfficeLaunchOptions): Promise<OfficeLaunchOutcome> => { late = options?.onLateHandoff; return "not-installed"; });
    const loadInstallers = vi.fn(() => new Promise<{ installers: [] }>((resolve) => { release = () => resolve({ installers: [] }); }));
    render(<OfficeHomeLaunch {...props({ launch, loadInstallers })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open UniWork Office" }));
    await waitFor(() => expect(loadInstallers).toHaveBeenCalled());
    act(() => late?.());
    await act(async () => { release(); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("treats a failed launch like a missing app", async () => {
    const p = props({ launch: vi.fn(async () => Promise.reject(new Error("blocked"))) });
    render(<OfficeHomeLaunch {...p} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open UniWork Office" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("is hidden on a device no installer exists for", async () => {
    const loadPlatformHint = vi.fn(async (): Promise<DesktopPlatformGuess> => ({ platform: null, confidence: "unsupported" }));
    render(<OfficeHomeLaunch {...props({ loadPlatformHint })} />);
    await waitFor(() => expect(loadPlatformHint).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Open UniWork Office" })).not.toBeInTheDocument();
  });

  it("holds the button with aria-disabled while it launches, so focus stays and a second click does nothing", async () => {
    let finish: (outcome: OfficeLaunchOutcome) => void = () => undefined;
    const launch = vi.fn(() => new Promise<OfficeLaunchOutcome>((resolve) => { finish = resolve; }));
    render(<OfficeHomeLaunch {...props({ launch })} />);
    const button = await screen.findByRole("button", { name: "Open UniWork Office" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"));
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(launch).toHaveBeenCalledOnce();
    finish("launched");
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
  });

  it("keeps the label for assistive tech when it is icon-only on a phone", async () => {
    render(<OfficeHomeLaunch {...props()} />);
    const button = await screen.findByRole("button", { name: "Open UniWork Office" });
    expect(button.querySelector("span")).toHaveClass("max-sm:sr-only");
  });
});
