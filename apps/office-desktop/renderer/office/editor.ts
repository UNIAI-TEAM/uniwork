import type { OfficeFormat } from "@uniwork/office-contracts";
import type { DesktopIpcChannel, DesktopIpcRequest, DesktopOfficeOpenResponse } from "../../shared/ipc";
import type { LibraryBridge } from "../library/model";

export type DesktopDocxEditor = Readonly<{
  open(): Promise<DesktopOfficeOpenResponse>;
  markDirty(): void;
  save(entryPoint?: "button" | "menu" | "shortcut"): Promise<void>;
  handleNativeSave(): Promise<void>;
  getDocumentId(): string;
  getDirty(): boolean;
}>;

/** Minimal host binding for the shared DOCX shell. The actual editor handle
 * and G3 save coordinator are supplied by the shared view; this controller
 * gives both the toolbar and the native menu one guarded Save action. */
export function createDesktopDocxEditor(options: {
  bridge: LibraryBridge;
  sessionGeneration: string;
  workspaceId: string;
  documentId: string;
  version?: number;
  saveAction: (entryPoint: "button" | "menu" | "shortcut") => Promise<void>;
}): DesktopDocxEditor {
  let dirty = false;
  let opened: DesktopOfficeOpenResponse | undefined;
  const request = <C extends DesktopIpcChannel>(channel: C, payload: DesktopIpcRequest<C>) => options.bridge.call(channel, payload);
  const save = async (entryPoint: "button" | "menu" | "shortcut" = "button"): Promise<void> => {
    if (!dirty || !opened) return;
    await options.saveAction(entryPoint);
    dirty = false;
  };
  const handleNativeSave = () => save("menu");
  return Object.freeze({
    async open() {
      opened = await request("desktop:office-open", { sessionGeneration: options.sessionGeneration, workspaceId: options.workspaceId, documentId: options.documentId, ...(options.version === undefined ? {} : { version: options.version }) }) as DesktopOfficeOpenResponse;
      return opened;
    },
    markDirty() { dirty = true; },
    save,
    handleNativeSave,
    getDocumentId() { return options.documentId; },
    getDirty() { return dirty; },
  });
}

export type { OfficeFormat };
