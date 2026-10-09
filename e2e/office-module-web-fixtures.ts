import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { e2eApiUrl } from "./api-url";

/**
 * Helpers for the genoffice module frames (UNI-1014/1015/1016), the module
 * counterpart of office-docs-web-fixtures.ts. A module bundle reaches the web
 * build the same way the Docs one does: `<module>.pin.json` names it and
 * `office-frame-sync.mjs --ensure` installs it from OFFICE_FRAME_SOURCE (a
 * fork dist-web root holding `<module>/<version>/`) during `pnpm build`. A
 * spec skips itself when its module is not installed in the build under test.
 */
const repoRoot = basename(process.cwd()).toLowerCase() === "e2e" ? resolve(process.cwd(), "..") : process.cwd();

export type FrameModule = "pdf" | "markdown" | "html" | "slides" | "sheets";

export interface ModulePin {
  version: string;
  entry: string;
}

/** The checked-in (or locally re-pinned) pin of a module, null when it has none. */
export function readModulePin(module: FrameModule): ModulePin | null {
  const path = resolve(repoRoot, `apps/web/platform/office-frame/${module}.pin.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ModulePin) : null;
}

/** Same-origin base path of a module build. */
export function moduleFrameBase(module: FrameModule, pin: ModulePin): string {
  return `/office-frame/${module}/${pin.version}`;
}

/** Whether the web build under test serves the pinned build of the module. */
export async function moduleFrameInstalled(request: APIRequestContext, baseUrl: string, module: FrameModule): Promise<boolean> {
  const pin = readModulePin(module);
  if (!pin) return false;
  try {
    return (await request.get(`${baseUrl}${moduleFrameBase(module, pin)}/manifest.json`)).ok();
  } catch {
    return false;
  }
}

/** The host's wrapper of a module frame (OfficeModuleFrame), by module and state. */
export function moduleFrameHost(page: Page, module: FrameModule) {
  return page.locator(`[data-office-docs-frame][data-office-module="${module}"]`);
}

export async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

/** The bytes stored as `version` of a document. */
export async function versionBytes(request: APIRequestContext, token: string, documentId: string, version: number): Promise<Buffer> {
  const response = await request.get(`${e2eApiUrl}/api/v1/documents/${documentId}/download?version=${version}`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.ok(), `download v${version}: HTTP ${response.status()}`).toBeTruthy();
  return response.body();
}
