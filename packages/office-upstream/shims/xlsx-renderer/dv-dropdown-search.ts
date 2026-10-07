// UNI-953 (visual-final nit): a double-click into a list-validated cell opens
// the cell editor AND Univer's list dropdown, whose search input focuses itself
// (autoFocus + a 0 ms focus timer). Typed text then split between the two: the
// first key reached the cell, the rest the dropdown search. A list dropdown
// shown while the cell editor is open now comes without its search, so every
// key goes to the cell; one opened from the cell's arrow (no editor) keeps it.
import { type IDisposable } from "@univerjs/core";
import { IEditorBridgeService, ISheetCellDropdownManagerService } from "@univerjs/sheets-ui";

interface DropdownParam {
  type: string;
  props?: Record<string, unknown>;
}

export interface DvDropdownSearchPorts {
  dropdowns: { showDropdown(param: DropdownParam): unknown };
  editorVisible: () => boolean;
}

/** Wraps `showDropdown` on the service instance; dispose restores it. */
export function guardListSearchWhileEditing(ports: DvDropdownSearchPorts): IDisposable {
  const { dropdowns } = ports;
  const original = dropdowns.showDropdown;
  dropdowns.showDropdown = function showDropdown(this: unknown, param: DropdownParam) {
    const next = param.type === "list" && param.props?.showSearch !== false && ports.editorVisible()
      ? { ...param, props: { ...param.props, showSearch: false } }
      : param;
    return original.call(this, next);
  };
  return { dispose: () => { dropdowns.showDropdown = original; } };
}

interface InjectorLike {
  get<T>(token: unknown): T;
}

export function installDvDropdownSearchGuard(injector: InjectorLike): IDisposable {
  const bridge = injector.get<{ isVisible(): { visible: boolean } }>(IEditorBridgeService);
  return guardListSearchWhileEditing({
    dropdowns: injector.get<DvDropdownSearchPorts["dropdowns"]>(ISheetCellDropdownManagerService),
    editorVisible: () => bridge.isVisible().visible,
  });
}
