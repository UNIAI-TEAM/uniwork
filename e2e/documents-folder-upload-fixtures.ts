import { expect, type Locator, type Page } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  createFolder,
  listDocuments,
  loginFolderUser,
  seedFolderWorkspace,
} from "./documents-folders-fixtures";

/**
 * Shared pieces of e2e/documents-folder-upload.spec.ts (UNI-2052): the scene
 * (a workspace with one folder that receives the uploads), the fixture tree on
 * disk, the menu -> file chooser path, a folder drop built in the page, the
 * config patch that lowers the limits, and an API walk of what landed.
 */

const repoRoot =
  basename(process.cwd()).toLowerCase() === "e2e"
    ? resolve(process.cwd(), "..")
    : process.cwd();

/** The 3-level fixture: root files, "Hop dong/", "Hop dong/2026/", plus a hidden and an unsupported file. */
export const TREE_NAME = "Ho so 2052";
export const TREE_DIR = resolve(repoRoot, "e2e/fixtures/folder-upload", TREE_NAME);

/** What the planner uploads from the fixture: relative folder paths (root = "") and file stems by folder. */
export const EXPECTED_FOLDERS = ["", "Hop dong", "Hop dong/2026"] as const;
export const EXPECTED_FILES = [
  "tong-quan",
  "Hop dong/mau-hop-dong",
  "Hop dong/2026/bao-gia",
  "Hop dong/2026/ke-hoach",
] as const;

export const TARGET_FOLDER = "Nhận tải lên";

/** A title without its extension: whether the server keeps ".md" in a file's title is not what these specs pin. */
export function stemOf(title: string): string {
  return title.replace(/\.[^./]+$/, "");
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface UploadScene {
  orgSlug: string;
  wsSlug: string;
  wsId: string;
  owner: { token: string; email: string };
  member?: { id: string; token: string; email: string };
  /** The folder that is open in the library, and the destination of every upload. */
  target: { id: string; title: string };
}

/** A fresh workspace, the target folder, the owner signed in and the library open on that folder. */
export async function seedUploadScene(page: Page, tag: string, options?: { withMemberB?: boolean }): Promise<UploadScene> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ws = await seedFolderWorkspace(page, tag, options);
  const target = await createFolder(page, ws.owner.token, ws.wsId, TARGET_FOLDER);
  return {
    orgSlug: ws.orgSlug,
    wsSlug: ws.wsSlug,
    wsId: ws.wsId,
    owner: { token: ws.owner.token, email: ws.owner.email },
    member: ws.member,
    target: { id: target.id, title: target.title },
  };
}

export async function openTarget(page: Page, scene: UploadScene, email: string = scene.owner.email): Promise<void> {
  await loginFolderUser(page, email);
  await gotoTarget(page, scene);
}

export async function gotoTarget(page: Page, scene: UploadScene): Promise<void> {
  await page.goto(`/${scene.orgSlug}/${scene.wsSlug}/documents?folder=${scene.target.id}`);
  await expect(
    page.getByRole("navigation", { name: "Đường dẫn thư mục" }).getByText(scene.target.title),
  ).toBeVisible({ timeout: 60_000 });
}

/** The "Tải lên" menu of the toolbar (a plain button when the server has no folder-upload block). */
export function uploadMenuButton(page: Page): Locator {
  return page.getByRole("button", { name: "Tải lên", exact: true });
}

/** Menu -> "Tải lên thư mục" -> the browser's directory chooser, answered with `dir`. */
export async function pickFolder(page: Page, dir: string = TREE_DIR): Promise<void> {
  await uploadMenuButton(page).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Tải lên thư mục" }).click();
  await (await chooser).setFiles(dir);
}

export function folderDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Tải lên thư mục" });
}

/** The pre-flight dialog of either mode: both render the summary line. */
export function preflightDialog(page: Page): Locator {
  return page.getByRole("dialog").filter({ has: page.getByTestId("folder-upload-summary") });
}

export function shareSwitch(dialog: Locator): Locator {
  return dialog.getByRole("switch", { name: "Chia sẻ với workspace" });
}

export function submitButton(dialog: Locator): Locator {
  return dialog.getByRole("button", { name: "Tải lên", exact: true });
}

/** The aggregate toast of a finished run: "Đã tải lên 4 tệp vào «Ho so 2052»". */
export async function expectDoneToast(page: Page, count: number, name: string): Promise<void> {
  await expect(page.getByText(`Đã tải lên ${count} tệp vào «${name}»`)).toBeVisible({ timeout: 120_000 });
}

/** A row of the library table whose title contains `stem` (a file's title may or may not keep its extension). */
export function libraryRows(page: Page, stem: string): Locator {
  return page
    .getByRole("table", { name: "Tài liệu" })
    .locator("tbody tr")
    .filter({ hasText: new RegExp(escapeRegExp(stem)) });
}

// ---- the fixture tree, readable in the page ---------------------------------

export interface TreeNode {
  name: string;
  kind: "file" | "dir";
  /** Base64 of the file's bytes (files only). */
  b64?: string;
  children?: TreeNode[];
}

/** The fixture directory as data, hidden and unsupported files included: a drop carries them too. */
export function readTree(dir: string = TREE_DIR): TreeNode {
  const walk = (path: string): TreeNode => {
    const name = basename(path);
    if (!statSync(path).isDirectory()) {
      return { name, kind: "file", b64: readFileSync(path).toString("base64") };
    }
    return { name, kind: "dir", children: readdirSync(path).sort().map((child) => walk(join(path, child))) };
  };
  return walk(dir);
}

/**
 * Drops `tree` on the library as a folder. Playwright cannot build a
 * FileSystemEntry, so the page gets a DragEvent whose dataTransfer is a plain
 * object: one item whose webkitGetAsEntry() answers a fake directory entry
 * backed by real File objects. The app's reader only calls isDirectory /
 * isFile, createReader().readEntries() (a batch, then an empty one) and
 * file(); the drop handler itself only reads types, items, kind and
 * webkitGetAsEntry().
 */
export async function dropFolder(page: Page, tree: TreeNode): Promise<void> {
  const zone = page.getByRole("region", { name: "Tài liệu", exact: true });
  await zone.evaluate((el, root) => {
    const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const entryOf = (node: TreeNode): unknown =>
      node.kind === "file"
        ? {
            isFile: true,
            isDirectory: false,
            name: node.name,
            file: (ok: (file: File) => void) => ok(new File([bytes(node.b64 ?? "")], node.name)),
          }
        : {
            isFile: false,
            isDirectory: true,
            name: node.name,
            createReader: () => {
              let served = false;
              return {
                readEntries: (ok: (entries: unknown[]) => void) => {
                  if (served) return ok([]);
                  served = true;
                  return ok((node.children ?? []).map(entryOf));
                },
              };
            },
          };
    const item = { kind: "file", type: "", getAsFile: () => null, webkitGetAsEntry: () => entryOf(root) };
    const dataTransfer = { types: ["Files"], files: [], items: [item], dropEffect: "none", effectAllowed: "all" };
    for (const type of ["dragenter", "dragover", "drop"]) {
      const event = new DragEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      el.dispatchEvent(event);
    }
  }, tree);
}

// ---- limits -----------------------------------------------------------------

/**
 * Rewrites the folder-upload limits in GET /api/v1/config before the app reads
 * them. The pre-flight refusal is the client's, driven by that block, so a
 * lowered `max_files` proves the refusal and its numbers without a server env
 * switch. Call it before the first navigation.
 */
export async function lowerFolderUploadLimits(page: Page, patch: Record<string, number>): Promise<void> {
  await page.route(/\/api\/v1\/config(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { documents?: { limits?: Record<string, unknown> } };
    const limits = { ...(body.documents?.limits ?? {}) };
    const block = (limits.folder_upload ?? {}) as Record<string, unknown>;
    limits.folder_upload = {
      max_files: 500,
      max_folders: 500,
      max_total_bytes: 2 * 1024 ** 3,
      max_depth: 20,
      complete_batch: 50,
      parallel: 6,
      ...block,
      ...patch,
    };
    await route.fulfill({ response, json: { ...body, documents: { ...body.documents, limits } } });
  });
}

// ---- what landed ------------------------------------------------------------

export interface LandedTree {
  /** Folder path under the top folder ("" = the top folder itself) -> its visibility. */
  folders: Map<string, string>;
  /** File path under the top folder, stem only -> its visibility. */
  files: Map<string, string>;
}

/** Walks `rootId` through the list API, level by level. */
export async function readLanded(page: Page, scene: UploadScene, rootId: string): Promise<LandedTree> {
  const landed: LandedTree = { folders: new Map([["", "restricted"]]), files: new Map() };
  const rootDoc = await listDocuments(page, scene.owner.token, scene.wsId, { parent_id: scene.target.id });
  const top = rootDoc.documents.find((d) => d.id === rootId);
  if (top) landed.folders.set("", top.visibility);
  const visit = async (folderId: string, prefix: string): Promise<void> => {
    const { documents } = await listDocuments(page, scene.owner.token, scene.wsId, { parent_id: folderId, limit: 200 });
    for (const doc of documents) {
      if (doc.kind === "folder") {
        landed.folders.set(`${prefix}${doc.title}`, doc.visibility);
        await visit(doc.id, `${prefix}${doc.title}/`);
      } else {
        landed.files.set(`${prefix}${stemOf(doc.title)}`, doc.visibility);
      }
    }
  };
  await visit(rootId, "");
  return landed;
}

/** The folders directly under the target, by title. */
export async function targetFolders(page: Page, scene: UploadScene): Promise<Array<{ id: string; title: string }>> {
  const { documents } = await listDocuments(page, scene.owner.token, scene.wsId, {
    parent_id: scene.target.id,
    kind: "folder",
    limit: 200,
  });
  return documents.map((d) => ({ id: d.id, title: d.title }));
}
