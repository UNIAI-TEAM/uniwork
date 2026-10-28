"use client";

import { runtimeConfig } from "@uniwork/core/runtime-config";

/**
 * Google Picker adapter contract, real browser implementation (`apis.google.com/js/api.js`),
 * and deterministic fake implementation for tests and E2E (spec §7.1, §7.10; UNI-2187).
 *
 * No Next.js APIs are used here and no page CSP change is needed.
 */

export const GOOGLE_API_SCRIPT_URL = "https://apis.google.com/js/api.js";

export interface DrivePickedFile {
  id: string;
  name: string;
  mimeType: string;
  /**
   * Optional pre-link sharing state known from the Picker document (`isShared`)
   * or scripted by the fake adapter: `"private"` | `"shared"` | `"unknown"`.
   * When omitted, treated as `"unknown"` (`!== "shared"`).
   */
  sharingState?: "private" | "shared" | "unknown";
}

export interface DrivePickerOpenOptions {
  token: string;
  developerKey: string;
  appId: string;
  locale: string;
  fileIds?: string[];
  multiselect?: boolean;
  title?: string;
  /**
   * Folder mode ("Name this folder"): the same three views as the file mode (My Drive, Shared with me,
   * Shared Drives), listing folders only and letting a folder be selected. `fileIds` is ignored.
   */
  selectFolder?: boolean;
}

export type DrivePickerOpenResult =
  | { status: "picked"; files: DrivePickedFile[] }
  | { status: "cancelled" }
  | { status: "error"; reason: "script_load_failed" | "picker_failed"; message?: string };

export interface DrivePickerAdapter {
  open(options: DrivePickerOpenOptions): Promise<DrivePickerOpenResult>;
}

/**
 * Window global hook for E2E and tests in non-production environments.
 */
export type FakeDrivePickerWindowOverride =
  | DrivePickerAdapter
  | DrivePickerOpenResult
  | DrivePickedFile[]
  | ((options: DrivePickerOpenOptions) => DrivePickerOpenResult | Promise<DrivePickerOpenResult>);

interface GoogleDocsViewInstance {
  setIncludeFolders(include: boolean): GoogleDocsViewInstance;
  setSelectFolderEnabled(enabled: boolean): GoogleDocsViewInstance;
  setOwnedByMe(owned: boolean): GoogleDocsViewInstance;
  setEnableDrives(enabled: boolean): GoogleDocsViewInstance;
  setFileIds(ids: string): GoogleDocsViewInstance;
  setMimeTypes(mimeTypes: string): GoogleDocsViewInstance;
}

interface GooglePickerBuilderInstance {
  setOAuthToken(token: string): GooglePickerBuilderInstance;
  setDeveloperKey(key: string): GooglePickerBuilderInstance;
  setAppId(appId: string): GooglePickerBuilderInstance;
  setLocale(locale: string): GooglePickerBuilderInstance;
  setTitle(title: string): GooglePickerBuilderInstance;
  enableFeature(feature: string): GooglePickerBuilderInstance;
  addView(view: GoogleDocsViewInstance): GooglePickerBuilderInstance;
  setCallback(callback: (data: GooglePickerCallbackData) => void): GooglePickerBuilderInstance;
  build(): { setVisible(visible: boolean): void };
}

interface GooglePickerDocument {
  id?: string;
  name?: string;
  mimeType?: string;
  isShared?: boolean;
  shared?: boolean;
  [key: string]: unknown;
}

interface GooglePickerCallbackData {
  action?: string;
  docs?: GooglePickerDocument[];
  [key: string]: unknown;
}

interface GooglePickerNamespace {
  ViewId: {
    DOCS: string;
  };
  Feature: {
    MULTISELECT_ENABLED: string;
    SUPPORT_DRIVES: string;
  };
  Action: {
    PICKED: string;
    CANCEL: string;
    ERROR?: string;
  };
  Document?: {
    ID?: string;
    NAME?: string;
    MIME_TYPE?: string;
    IS_SHARED?: string;
  };
  DocsView: new (viewId?: string) => GoogleDocsViewInstance;
  PickerBuilder: new () => GooglePickerBuilderInstance;
}

interface GapiGlobal {
  load: (
    apiName: string,
    callbackOrConfig:
      | (() => void)
      | {
          callback: () => void;
          onerror?: () => void;
          timeout?: number;
          ontimeout?: () => void;
        },
  ) => void;
}

declare global {
  interface Window {
    gapi?: GapiGlobal;
    google?: {
      picker?: GooglePickerNamespace;
    };
    __UNIWORK_FAKE_DRIVE_PICKER__?: FakeDrivePickerWindowOverride;
  }
}

let scriptLoadPromise: Promise<GooglePickerNamespace> | null = null;

/**
 * Resets the cached Google Picker script loader promise so a retry after a
 * transient network error (or a unit test) can attempt loading again.
 */
export function resetGooglePickerScriptLoaderForTests(): void {
  scriptLoadPromise = null;
}

function getLoadedGooglePicker(): GooglePickerNamespace | null {
  if (typeof window === "undefined") return null;
  return window.google?.picker ?? null;
}

function ensureGoogleApiScriptElement(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Google Picker requires a browser document"));
  }
  if (window.gapi && typeof window.gapi.load === "function") {
    return Promise.resolve();
  }

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${GOOGLE_API_SCRIPT_URL}"]`,
  );
  if (existing) {
    if (existing.dataset.loaded === "true" && window.gapi) {
      resolve();
      return promise;
    }
    if (existing.dataset.failed === "true") {
      existing.remove();
    } else {
      const onLoad = () => {
        existing.dataset.loaded = "true";
        cleanup();
        resolve();
      };
      const onError = () => {
        existing.dataset.failed = "true";
        cleanup();
        existing.remove();
        reject(new Error("Failed to load Google API script"));
      };
      const cleanup = () => {
        existing.removeEventListener("load", onLoad);
        existing.removeEventListener("error", onError);
      };
      existing.addEventListener("load", onLoad);
      existing.addEventListener("error", onError);
      return promise;
    }
  }

  const script = document.createElement("script");
  script.src = GOOGLE_API_SCRIPT_URL;
  script.async = true;
  script.defer = true;
  script.onload = () => {
    script.dataset.loaded = "true";
    resolve();
  };
  script.onerror = () => {
    script.dataset.failed = "true";
    script.remove();
    reject(new Error("Failed to load Google API script"));
  };
  (document.head ?? document.body ?? document.documentElement).appendChild(script);
  return promise;
}

function loadGooglePickerNamespace(): Promise<GooglePickerNamespace> {
  const existing = getLoadedGooglePicker();
  if (existing) return Promise.resolve(existing);
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = ensureGoogleApiScriptElement()
    .then(() => {
      const { promise, resolve, reject } = Promise.withResolvers<GooglePickerNamespace>();
      const gapi = window.gapi;
      if (!gapi || typeof gapi.load !== "function") {
        reject(new Error("gapi.load is not available"));
        return promise;
      }
      gapi.load("picker", {
        callback: () => {
          const picker = getLoadedGooglePicker();
          if (picker) {
            resolve(picker);
          } else {
            reject(new Error("google.picker namespace missing after gapi.load"));
          }
        },
        onerror: () => reject(new Error("gapi.load('picker') failed")),
        timeout: 15_000,
        ontimeout: () => reject(new Error("gapi.load('picker') timed out")),
      });
      return promise;
    })
    .catch((err: unknown) => {
      scriptLoadPromise = null;
      throw err;
    });

  return scriptLoadPromise;
}

/**
 * Reads the pre-link sharing flag from a Picker document defensively, failing
 * safe to `"unknown"` whenever the Picker omits the field so the Q6 task
 * confirmation dialog is shown rather than silently skipped (R1-5).
 *
 * Note for Q2 (real Google verification): confirm the exact sharing field name
 * exposed on `google.picker.Document` / picked doc payloads against live Google
 * Picker (`Object.keys(google.picker.Document)` and a picked doc's keys).
 */
function extractSharingState(
  doc: GooglePickerDocument,
  picker: GooglePickerNamespace,
): "private" | "shared" | "unknown" {
  const docConstants = picker.Document as Record<string, string | undefined> | undefined;
  const dynamicKey = docConstants?.IS_SHARED;
  const candidate =
    (typeof dynamicKey === "string" ? doc[dynamicKey] : undefined) ??
    doc.isShared ??
    doc.shared;
  if (candidate === true) return "shared";
  if (candidate === false) return "private";
  return "unknown";
}

function mapPickerDocuments(
  docs: GooglePickerDocument[] | undefined,
  picker: GooglePickerNamespace,
): DrivePickedFile[] {
  if (!Array.isArray(docs)) return [];
  const idKey = picker.Document?.ID ?? "id";
  const nameKey = picker.Document?.NAME ?? "name";
  const mimeKey = picker.Document?.MIME_TYPE ?? "mimeType";

  const picked: DrivePickedFile[] = [];
  for (const doc of docs) {
    const id = typeof doc[idKey] === "string" ? doc[idKey] : typeof doc.id === "string" ? doc.id : "";
    if (!id) continue;
    const name =
      typeof doc[nameKey] === "string"
        ? doc[nameKey]
        : typeof doc.name === "string"
          ? doc.name
          : id;
    const mimeType =
      typeof doc[mimeKey] === "string"
        ? doc[mimeKey]
        : typeof doc.mimeType === "string"
          ? doc.mimeType
          : "application/octet-stream";
    picked.push({
      id,
      name,
      mimeType,
      sharingState: extractSharingState(doc, picker),
    });
  }
  return picked;
}

/**
 * Keeps folder navigation enabled (`setIncludeFolders(true)`) so users can
 * browse inside folders, while disabling folder selection
 * (`setSelectFolderEnabled(false)`) per spec §7.1 "không cho chọn thư mục" (R1-6).
 */
function configureNoFolderSelection(view: GoogleDocsViewInstance): GoogleDocsViewInstance {
  view.setIncludeFolders?.(true);
  view.setSelectFolderEnabled?.(false);
  return view;
}

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

/** A view limited to folders, where a folder itself can be selected (Name this folder). */
function configureFolderSelection(view: GoogleDocsViewInstance): GoogleDocsViewInstance {
  view.setIncludeFolders?.(true);
  view.setSelectFolderEnabled?.(true);
  view.setMimeTypes?.(FOLDER_MIME_TYPE);
  return view;
}

/**
 * Real Google Picker adapter that loads `https://apis.google.com/js/api.js` once,
 * calls `gapi.load("picker")`, and configures My Drive, Shared with me, and
 * Shared Drives (`setEnableDrives(true)`), no folder selection, UI locale,
 * multiselect, and `setFileIds` when provided (spec §7.1, S2).
 */
export const googleDrivePickerAdapter: DrivePickerAdapter = {
  async open(options: DrivePickerOpenOptions): Promise<DrivePickerOpenResult> {
    let picker: GooglePickerNamespace;
    try {
      picker = await loadGooglePickerNamespace();
    } catch (err) {
      return {
        status: "error",
        reason: "script_load_failed",
        message: err instanceof Error ? err.message : undefined,
      };
    }

    const { promise, resolve } = Promise.withResolvers<DrivePickerOpenResult>();
    try {
      const builder = new picker.PickerBuilder()
        .setOAuthToken(options.token)
        .setDeveloperKey(options.developerKey)
        .setAppId(options.appId)
        .setLocale(options.locale || "vi");

      if (options.title) {
        builder.setTitle(options.title);
      }

      if (picker.Feature?.SUPPORT_DRIVES) {
        builder.enableFeature(picker.Feature.SUPPORT_DRIVES);
      }
      if ((options.multiselect ?? true) && !options.selectFolder && picker.Feature?.MULTISELECT_ENABLED) {
        builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
      }

      const fileIds = (options.fileIds ?? []).filter((id) => id.trim().length > 0);
      if (!options.selectFolder && fileIds.length > 0) {
        const preselectedView = configureNoFolderSelection(
          new picker.DocsView(picker.ViewId?.DOCS),
        );
        preselectedView.setFileIds?.(fileIds.join(","));
        builder.addView(preselectedView);
      } else {
        // 1. My files (owned by me), 2. Shared with me, 3. Shared Drives. Folder mode only swaps the
        // per-view setup, so a folder in a Shared Drive or owned by someone else can be picked too.
        const configure = options.selectFolder ? configureFolderSelection : configureNoFolderSelection;
        const myDriveView = configure(new picker.DocsView(picker.ViewId?.DOCS));
        myDriveView.setOwnedByMe?.(true);
        builder.addView(myDriveView);

        const sharedWithMeView = configure(new picker.DocsView(picker.ViewId?.DOCS));
        sharedWithMeView.setOwnedByMe?.(false);
        builder.addView(sharedWithMeView);

        const sharedDrivesView = configure(new picker.DocsView(picker.ViewId?.DOCS));
        sharedDrivesView.setEnableDrives?.(true);
        builder.addView(sharedDrivesView);
      }

      let settled = false;
      builder.setCallback((data: GooglePickerCallbackData) => {
        if (settled) return;
        const action = data?.action;
        if (action === (picker.Action?.PICKED ?? "picked")) {
          settled = true;
          const files = mapPickerDocuments(data.docs, picker);
          if (files.length === 0) {
            resolve({ status: "cancelled" });
            return;
          }
          resolve({ status: "picked", files });
          return;
        }
        if (action === (picker.Action?.CANCEL ?? "cancel")) {
          settled = true;
          resolve({ status: "cancelled" });
          return;
        }
        if (action === (picker.Action?.ERROR ?? "error")) {
          settled = true;
          resolve({ status: "error", reason: "picker_failed" });
        }
      });

      builder.build().setVisible(true);
    } catch (err) {
      resolve({
        status: "error",
        reason: "picker_failed",
        message: err instanceof Error ? err.message : undefined,
      });
    }
    return promise;
  },
};

export interface FakeDrivePickerController extends DrivePickerAdapter {
  readonly calls: DrivePickerOpenOptions[];
  setNextResult(result: DrivePickerOpenResult): void;
  setPickedFiles(files: DrivePickedFile[]): void;
  reset(): void;
}

/**
 * Deterministic fake `DrivePickerAdapter` for unit tests and Playwright E2E
 * (no network requests). Records every `open()` call and returns the scripted
 * result.
 */
export function createFakeDrivePickerAdapter(
  initialResult: DrivePickerOpenResult = {
    status: "picked",
    files: [
      {
        id: "fake_drive_doc_1",
        name: "Kế hoạch ra mắt Q4",
        mimeType: "application/vnd.google-apps.document",
        sharingState: "private",
      },
    ],
  },
): FakeDrivePickerController {
  let currentResult: DrivePickerOpenResult = initialResult;
  const calls: DrivePickerOpenOptions[] = [];

  return {
    calls,
    setNextResult(result: DrivePickerOpenResult) {
      currentResult = result;
    },
    setPickedFiles(files: DrivePickedFile[]) {
      currentResult = { status: "picked", files };
    },
    reset() {
      calls.length = 0;
      currentResult = initialResult;
    },
    open(options: DrivePickerOpenOptions): Promise<DrivePickerOpenResult> {
      calls.push(options);
      return Promise.resolve(currentResult);
    },
  };
}

function isFakeWindowOverrideAllowed(): boolean {
  if (typeof window === "undefined") return false;
  return runtimeConfig().allowFakeDrivePicker === true;
}

function isDrivePickerAdapter(
  value: DrivePickerAdapter | DrivePickerOpenResult,
): value is DrivePickerAdapter {
  return "open" in value && typeof value.open === "function";
}

function adaptWindowFakeOverride(
  override: FakeDrivePickerWindowOverride,
): DrivePickerAdapter {
  if (typeof override === "function") {
    return {
      open: async (options) => override(options),
    };
  }
  if (Array.isArray(override)) {
    return {
      open: () => Promise.resolve({ status: "picked", files: override }),
    };
  }
  if (isDrivePickerAdapter(override)) {
    return override;
  }
  return {
    open: () => Promise.resolve(override),
  };
}

/**
 * Resolves the active `DrivePickerAdapter`:
 * 1. Explicit `adapter` prop / option (used in unit tests).
 * 2. `window.__UNIWORK_FAKE_DRIVE_PICKER__` when `runtimeConfig().allowFakeDrivePicker`
 *    is explicitly enabled (default off).
 * 3. `googleDrivePickerAdapter` (real Google Picker).
 */
export function resolveDrivePickerAdapter(
  explicitAdapter?: DrivePickerAdapter,
): DrivePickerAdapter {
  if (explicitAdapter) return explicitAdapter;
  if (
    typeof window !== "undefined" &&
    window.__UNIWORK_FAKE_DRIVE_PICKER__ &&
    isFakeWindowOverrideAllowed()
  ) {
    return adaptWindowFakeOverride(window.__UNIWORK_FAKE_DRIVE_PICKER__);
  }
  return googleDrivePickerAdapter;
}
