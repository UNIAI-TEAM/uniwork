import type { Page } from "@playwright/test";

const HOST = "https://downloads.e2e.test/office/beta/0.9.0";

/** The installers the stubbed config publishes: known data, so a spec never depends on what a deployment has released. */
export const STUB_INSTALLERS = [
  { platform: "win32-x64", kind: ".exe", url: `${HOST}/Office-0.9.0-x64.exe`, version: "0.9.0" },
  { platform: "darwin-arm64", kind: ".dmg", url: `${HOST}/Office-0.9.0-arm64.dmg`, version: "0.9.0" },
  { platform: "linux-x64-deb", kind: ".deb", url: `${HOST}/Office-0.9.0-amd64.deb`, version: "0.9.0" },
];

/**
 * The Download section without a release manifest: it falls back to the config's
 * installers, and the config publishes STUB_INSTALLERS on beta only. The installer
 * files are served as attachments so a click is a real download. Call it before
 * the first navigation.
 */
export async function stubOfficeInstallerFallback(page: Page): Promise<void> {
  await page.route(/\/api\/v1\/config(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, office_installers: { dev: [], beta: STUB_INSTALLERS, stable: [] } } });
  });
  await page.route("**/downloads/office/releases.json", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route(`${HOST}/**`, (route) => route.fulfill({ status: 200, contentType: "application/octet-stream", headers: { "content-disposition": "attachment" }, body: "stub" }));
}
