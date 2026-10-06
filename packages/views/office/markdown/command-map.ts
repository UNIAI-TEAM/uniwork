import type { OfficeHost } from "@uniwork/core/office";

export type MarkdownCommandId = "undo" | "redo" | "save" | "copy" | "paste";
export interface MarkdownCommand {
  id: MarkdownCommandId;
  enabled: boolean;
  run(): void | Promise<void>;
}

export interface MarkdownClipboardPermissions {
  canCopy?: boolean;
  canPaste?: boolean;
}

/** The command map is callback-only; source bytes stay behind the editor port. */
export function createMarkdownCommandMap(options: {
  host: OfficeHost;
  onUndo(): void;
  onRedo(): void;
  onSave(): void;
  onCopy?(): void | Promise<void>;
  onPaste?(): void | Promise<void>;
  readOnly?: boolean;
  permissions?: MarkdownClipboardPermissions;
}): MarkdownCommand[] {
  const disabled = options.readOnly === true;
  return [
    { id: "undo", enabled: !disabled, run: options.onUndo },
    { id: "redo", enabled: !disabled, run: options.onRedo },
    { id: "save", enabled: !disabled, run: options.onSave },
    { id: "copy", enabled: !disabled && options.permissions?.canCopy !== false && Boolean(options.onCopy), run: () => options.onCopy?.() },
    { id: "paste", enabled: !disabled && options.permissions?.canPaste !== false && Boolean(options.onPaste), run: () => options.onPaste?.() },
  ];
}
