/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopFrame } from "./desktop-frame";
import type { RendererBridge } from "./app";

function installMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const media = { matches: initial, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
  vi.stubGlobal("matchMedia", () => media);
  return { flip: (matches: boolean) => { media.matches = matches; listeners.forEach((fn) => fn()); } };
}
const bridge = { call: vi.fn(async () => ({})) } as unknown as RendererBridge;

afterEach(() => { vi.unstubAllGlobals(); document.documentElement.classList.remove("dark"); });

it("follows the system theme after mount in both directions and publishes it", async () => {
  const system = installMedia(false);
  render(<DesktopFrame bridge={bridge}><p>x</p></DesktopFrame>);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  system.flip(true);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  await vi.waitFor(() => expect(bridge.call).toHaveBeenCalledWith("desktop:window-theme", expect.objectContaining({ dark: true })));
  system.flip(false);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

it("starts dark when the system already prefers dark", () => {
  installMedia(true);
  render(<DesktopFrame bridge={bridge}><p>x</p></DesktopFrame>);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});

it("follows main's nativeTheme event instead of the media query when the bridge carries it", async () => {
  installMedia(true);
  let emit: ((event: { dark: boolean }) => void) | undefined;
  const unsubscribe = vi.fn();
  const themed = { call: vi.fn(async () => ({})), onSessionChanged: () => () => undefined, onThemeChanged: (listener: (event: { dark: boolean }) => void) => { emit = listener; return unsubscribe; } };
  const view = render(<DesktopFrame bridge={themed}><p>x</p></DesktopFrame>);
  // The media query no longer decides: index applied main's snapshot before mount.
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  emit?.({ dark: true });
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  await vi.waitFor(() => expect(themed.call).toHaveBeenCalledWith("desktop:window-theme", expect.objectContaining({ dark: true })));
  emit?.({ dark: false });
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
