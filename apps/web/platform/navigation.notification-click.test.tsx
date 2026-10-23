import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { showWebNotification, type SystemNotificationPayload } from "@uniwork/core/platform";
import { WebNavigationProvider } from "./navigation";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/acme/team/tasks",
  useSearchParams: () => new URLSearchParams(),
}));

let banners: Array<{ onclick: (() => void) | null }> = [];
class FakeNotification {
  static permission = "granted";
  onclick: (() => void) | null = null;
  constructor() {
    banners.push(this);
  }
  close() {}
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  banners = [];
  vi.stubGlobal("Notification", FakeNotification);
  vi.spyOn(window, "focus").mockImplementation(() => {});
  host =document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function banner(href: string): SystemNotificationPayload {
  return { slug: "team", itemId: "n1", issueKey: "n1", href, title: "Bình đã nhắn tin cho bạn", body: "" };
}

const flushed = () => new Promise((resolve) => setTimeout(resolve, 0));

// UNI-1074: no host registered a click handler, so a banner only focused the tab.
it("opens what a clicked browser banner points at", async () => {
  await act(async () => root.render(<WebNavigationProvider>{null}</WebNavigationProvider>));

  showWebNotification(banner("/acme/team/chat?room=r1&message=m1"));
  banners[0]?.onclick?.();
  await flushed();

  expect(router.push).toHaveBeenCalledWith("/acme/team/chat?room=r1&message=m1");
});

it("ignores a banner target that is not a same-origin path", async () => {
  await act(async () => root.render(<WebNavigationProvider>{null}</WebNavigationProvider>));

  showWebNotification(banner("https://evil.example/x"));
  banners[0]?.onclick?.();
  await flushed();

  expect(router.push).not.toHaveBeenCalled();
});
