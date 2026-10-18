import { expect, test } from "@playwright/test";
import { e2eApiUrl } from "./api-url";
import { registerVerified } from "./auth-nav";

/**
 * UNI-1826: the UniChat chat-only shell. A fake `window.desktopAPI` (the
 * DesktopBridge contract, packages/core/platform/desktop-bridge.ts) stands in
 * for the Electron preload; its session provider is backed by the refresh
 * cookie the browser already holds, so the app initialises through the
 * provider path for real. The fake records what the shell would have done in
 * `window.__uniChat`.
 */
interface UniChatProbe {
  badge: number[];
  external: string[];
  deepLink: ((url: string) => void) | null;
}

declare global {
  interface Window {
    __uniChat: UniChatProbe;
  }
}

const stamp = Date.now();
const orgSlug = `unichat-${stamp}`;
const orgName = `UniChat ${stamp}`;
const wsSlug = `team-${stamp}`;
const wsName = `Team ${stamp}`;

test("chat-only shell hides the module nav and hands other routes to the browser", async ({ page }) => {
  test.setTimeout(120_000);
  await registerVerified(page, "unichat-shell", stamp);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("radio", { name: "Kỹ sư / phát triển" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByLabel("Tên tổ chức").fill(orgName);
  await expect(page.getByLabel("Đường dẫn")).toHaveValue(orgSlug);
  await page.getByRole("button", { name: `Tạo ${orgName}` }).click();
  await page.getByLabel("Tên workspace").fill(wsName);
  await expect(page.getByLabel("Đường dẫn")).toHaveValue(wsSlug);
  await page.getByRole("button", { name: `Tạo ${wsName}` }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/`), { timeout: 30_000 });

  // Installed after onboarding: the next full navigation boots the app as the UniChat host.
  await page.addInitScript((apiUrl: string) => {
    const token = () =>
      fetch(`${apiUrl}/api/v1/auth/refresh`, { method: "POST", credentials: "include" }).then((r) =>
        r.ok ? r.json().then((j: { access_token?: string }) => j.access_token ?? null) : null,
      );
    window.__uniChat = { badge: [], external: [], deepLink: null };
    (window as unknown as { desktopAPI: unknown }).desktopAPI = {
      app: "unichat",
      appInfo: { version: "e2e", os: "unknown" },
      session: {
        login: () => Promise.resolve(),
        getAccessToken: token,
        refresh: token,
        logout: () =>
          fetch(`${apiUrl}/api/v1/auth/logout`, { method: "POST", credentials: "include" }).then(() => undefined),
        onChange: () => () => {},
      },
      setBadgeCount: (n: number) => {
        window.__uniChat.badge.push(n);
      },
      isFocused: () => Promise.resolve(true),
      onFocusChange: () => () => {},
      focusWindow: () => {},
      openExternal: (u: string) => {
        window.__uniChat.external.push(u);
        return Promise.resolve();
      },
      downloadURL: () => Promise.resolve(),
      onDeepLink: (cb: (url: string) => void) => {
        window.__uniChat.deepLink = cb;
        return () => {};
      },
    };
  }, e2eApiUrl);

  const chatPath = `/${orgSlug}/${wsSlug}/chat`;
  await page.goto(chatPath);
  await expect(page.getByPlaceholder("Nhập tin nhắn…")).toBeVisible({ timeout: 30_000 });

  // The workspace rail replaces the sidebar: the current workspace's tile, no module nav.
  await expect(
    page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: wsName, exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation").getByRole("link", { name: "Công việc", exact: true })).toHaveCount(0);

  // The dock badge mirrors the unread count: a fresh workspace reports 0.
  await expect.poll(() => page.evaluate(() => window.__uniChat.badge.at(-1))).toBe(0);

  // A deep link outside the allowlist leaves the shell as an absolute URL.
  const tasksPath = `/${orgSlug}/${wsSlug}/tasks/01HX`;
  await page.evaluate(
    (p) => window.__uniChat.deepLink?.(`uniworkchat://open?url=${encodeURIComponent(p)}`),
    tasksPath,
  );
  await expect.poll(() => page.evaluate(() => window.__uniChat.external)).toEqual([expect.stringMatching(/^https?:\/\//)]);
  expect((await page.evaluate(() => window.__uniChat.external))[0]).toMatch(new RegExp(`${tasksPath}$`));
  await expect(page).toHaveURL(new RegExp(`${chatPath}$`));

  // A deep link into chat is an in-shell push: no openExternal. It names the workspace's
  // own room: an unknown ?room= is dropped from the URL by design (use-chat-room-url.ts).
  const roomId = await page.evaluate(
    async ({ apiUrl, org, ws }) => {
      const refreshed = await fetch(`${apiUrl}/api/v1/auth/refresh`, { method: "POST", credentials: "include" });
      const { access_token: token } = (await refreshed.json()) as { access_token: string };
      const headers = { authorization: `Bearer ${token}` };
      const list = (await (await fetch(`${apiUrl}/api/v1/workspaces`, { headers })).json()) as {
        workspaces: { id: string; slug: string; organization_slug: string }[];
      };
      const wsId = list.workspaces.find((w) => w.slug === ws && w.organization_slug === org)?.id;
      const rooms = (await (await fetch(`${apiUrl}/api/v1/workspaces/${wsId}/chat/rooms`, { headers })).json()) as {
        rooms: { id: string }[];
      };
      return rooms.rooms[0]?.id ?? "";
    },
    { apiUrl: e2eApiUrl, org: orgSlug, ws: wsSlug },
  );
  expect(roomId, "the workspace's default room").not.toBe("");
  await page.evaluate(
    ({ p, room }) => window.__uniChat.deepLink?.(`uniworkchat://open?url=${encodeURIComponent(`${p}?room=${room}`)}`),
    { p: chatPath, room: roomId },
  );
  await expect(page).toHaveURL(new RegExp(`${chatPath}\\?room=${roomId}$`), { timeout: 20_000 });
  expect(await page.evaluate(() => window.__uniChat.external)).toHaveLength(1);
});
