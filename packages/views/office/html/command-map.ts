import type { OfficeHost } from "@uniwork/core/office";

export type HtmlCommandId = "undo" | "redo" | "save" | "copy" | "paste";
export interface HtmlCommand {
  id: HtmlCommandId;
  enabled: boolean;
  run(): void | Promise<void>;
}

export function createHtmlCommandMap(options: {
  host: OfficeHost;
  onUndo(): void;
  onRedo(): void;
  onSave(): void;
  onCopy?(): void | Promise<void>;
  onPaste?(): void | Promise<void>;
  readOnly?: boolean;
}): HtmlCommand[] {
  const disabled = options.readOnly === true;
  return [
    { id: "undo", enabled: !disabled, run: options.onUndo },
    { id: "redo", enabled: !disabled, run: options.onRedo },
    { id: "save", enabled: !disabled, run: options.onSave },
    { id: "copy", enabled: !disabled && Boolean(options.onCopy), run: () => options.onCopy?.() },
    { id: "paste", enabled: !disabled && Boolean(options.onPaste), run: () => options.onPaste?.() },
  ];
}
