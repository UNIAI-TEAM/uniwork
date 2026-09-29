import type { OfficeHost } from "@uniwork/core/office";

export type HtmlCommandId = "undo" | "redo" | "save" | "copy" | "paste";
export interface HtmlCommand {
  id: HtmlCommandId;
  enabled: boolean;
  run(): void | Promise<void>;
}

export interface HtmlClipboardPermissions {
  canCopy?: boolean;
  canPaste?: boolean;
}

export function createHtmlCommandMap(options: {
  host: OfficeHost;
  onUndo(): void;
  onRedo(): void;
  onSave(): void;
  onCopy?(): void | Promise<void>;
  onPaste?(): void | Promise<void>;
  readOnly?: boolean;
  permissions?: HtmlClipboardPermissions;
}): HtmlCommand[] {
  const disabled = options.readOnly === true;
  return [
    { id: "undo", enabled: !disabled, run: options.onUndo },
    { id: "redo", enabled: !disabled, run: options.onRedo },
    { id: "save", enabled: !disabled, run: options.onSave },
    { id: "copy", enabled: !disabled && options.permissions?.canCopy !== false && Boolean(options.onCopy), run: () => options.onCopy?.() },
    { id: "paste", enabled: !disabled && options.permissions?.canPaste !== false && Boolean(options.onPaste), run: () => options.onPaste?.() },
  ];
}
