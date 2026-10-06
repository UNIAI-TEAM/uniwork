import { LocaleType, mergeLocales, type IDisposable } from "@univerjs/core";
import UniverPresetSheetsConditionalFormattingEnUS from "@univerjs/preset-sheets-conditional-formatting/locales/en-US";
import UniverPresetSheetsConditionalFormattingViVN from "@univerjs/preset-sheets-conditional-formatting/locales/vi-VN";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import UniverPresetSheetsCoreViVN from "@univerjs/preset-sheets-core/locales/vi-VN";
import UniverPresetSheetsDataValidationEnUS from "@univerjs/preset-sheets-data-validation/locales/en-US";
import UniverPresetSheetsDataValidationViVN from "@univerjs/preset-sheets-data-validation/locales/vi-VN";
import UniverPresetSheetsFilterEnUS from "@univerjs/preset-sheets-filter/locales/en-US";
import UniverPresetSheetsFilterViVN from "@univerjs/preset-sheets-filter/locales/vi-VN";
import UniverPresetSheetsFindReplaceEnUS from "@univerjs/preset-sheets-find-replace/locales/en-US";
import UniverPresetSheetsFindReplaceViVN from "@univerjs/preset-sheets-find-replace/locales/vi-VN";
import UniverPresetSheetsNoteEnUS from "@univerjs/preset-sheets-note/locales/en-US";
import UniverPresetSheetsNoteViVN from "@univerjs/preset-sheets-note/locales/vi-VN";
import UniverPresetSheetsSortEnUS from "@univerjs/preset-sheets-sort/locales/en-US";
import UniverPresetSheetsSortViVN from "@univerjs/preset-sheets-sort/locales/vi-VN";
import UniverPresetSheetsTableEnUS from "@univerjs/preset-sheets-table/locales/en-US";
import UniverPresetSheetsTableViVN from "@univerjs/preset-sheets-table/locales/vi-VN";
import { SheetInterceptorService, VALIDATE_CELL } from "@univerjs/sheets";
import { IDialogService } from "@univerjs/ui";
import type { CreateUniverOptions } from "../../upstream/apps/sheets/src/renderer/create-univer";
import type { UniverRuntime } from "../../upstream/apps/sheets/src/renderer/univer-state";
import { getLang, t } from "./locale";

// ── Univer locale + data-validation rejection dialog (X01 vfix-dv) ─────────
//
// The pinned presets were registered en-US only, so the Univer surfaces the
// editor does show (the DV rejection dialog, the invalid-cell hint, the list
// dropdown) stayed English in the vi app. The renderer now starts in the app
// language with the presets' own vi-VN bundles, and the strings of the DV
// surfaces come from the app's i18n (office.xlsx.editor.dv*) on top. The
// pinned rejection dialog always titles itself with the locale's generic
// "Error"; the rule's own errorTitle (typed in the DV dialog, or read from the
// file) replaces it.

const REJECT_DIALOG_ID = "reject-input-dialog";
/** Ahead of the DV plugin's own VALIDATE_CELL handler (priority 0). */
const CONTEXT_PRIORITY = 1_000;

/** The app's copy for the DV surfaces, keyed like the pinned locale. */
function dataValidationOverrides() {
  return {
    "sheets-data-validation-ui": {
      alert: { title: t("dvRejectTitle"), ok: t("dvRejectOk") },
      error: { title: t("dvInvalidHint") },
    },
    "sheets-data-validation": {
      list: { error: t("dvListError"), dropdown: t("dvListDropdown"), edit: t("dvListEdit") },
    },
  };
}

/** createUniver's locale options: the app language, its preset bundles and
 *  the app's DV copy on top. */
export function rendererLocaleOptions(): Pick<CreateUniverOptions, "locale" | "locales"> {
  const vi = getLang() === "vi";
  const presets = vi
    ? [UniverPresetSheetsCoreViVN, UniverPresetSheetsConditionalFormattingViVN, UniverPresetSheetsFilterViVN,
      UniverPresetSheetsDataValidationViVN, UniverPresetSheetsNoteViVN, UniverPresetSheetsFindReplaceViVN,
      UniverPresetSheetsSortViVN, UniverPresetSheetsTableViVN]
    : [UniverPresetSheetsCoreEnUS, UniverPresetSheetsConditionalFormattingEnUS, UniverPresetSheetsFilterEnUS,
      UniverPresetSheetsDataValidationEnUS, UniverPresetSheetsNoteEnUS, UniverPresetSheetsFindReplaceEnUS,
      UniverPresetSheetsSortEnUS, UniverPresetSheetsTableEnUS];
  const locale = vi ? LocaleType.VI_VN : LocaleType.EN_US;
  return { locale, locales: { [locale]: mergeLocales(...presets, dataValidationOverrides()) } };
}

interface CellContext {
  unitId: string;
  subUnitId: string;
  row: number;
  col: number;
}

interface DialogConfig {
  id?: string;
  open?: boolean;
  title?: { title?: unknown };
}

/** The rule's own title for the cell, when it has a non-blank one. */
function ruleTitle(runtime: UniverRuntime, cell: CellContext): string | null {
  // The sheets and DV facades mix these in at runtime.
  const api = runtime.univerAPI as unknown as {
    getWorkbook(id: string): {
      getSheetBySheetId(id: string): {
        getRange(row: number, column: number): { getDataValidation?: () => { rule?: { errorTitle?: unknown } } | null };
      } | null;
    } | null;
  };
  const range = api.getWorkbook(cell.unitId)?.getSheetBySheetId(cell.subUnitId)?.getRange(cell.row, cell.col);
  const title = range?.getDataValidation?.()?.rule?.errorTitle;
  return typeof title === "string" && title.trim() !== "" ? title.trim() : null;
}

const PORTAL_ROOT_STYLE_ID = "uniwork-xlsx-portal-root-defaults";

/** The scoped sheet's Tailwind variable reset (`*` inside the @scope) reaches
 *  descendants of a scope root but not the root itself, so an adopted dialog
 *  root had an undefined transform variable and lost its centering. The same
 *  defaults at zero specificity, for adopted portal roots only; any utility
 *  class on the root still wins. */
function ensurePortalRootDefaults(doc: Document, scopeClass: string): void {
  if (doc.getElementById(PORTAL_ROOT_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = PORTAL_ROOT_STYLE_ID;
  style.textContent = `:where(body > .${scopeClass}[class*='univer-']){` +
    "--univer-tw-translate-x:0;--univer-tw-translate-y:0;--univer-tw-rotate:0;--univer-tw-skew-x:0;" +
    "--univer-tw-skew-y:0;--univer-tw-scale-x:1;--univer-tw-scale-y:1;--univer-tw-ring-offset-width:0px;" +
    "--univer-tw-ring-offset-color:#fff;--univer-tw-ring-color:#93c5fd80;--univer-tw-ring-offset-shadow:0 0 #0000;" +
    "--univer-tw-ring-shadow:0 0 #0000;--univer-tw-shadow:0 0 #0000;--univer-tw-shadow-colored:0 0 #0000}";
  doc.head.appendChild(style);
}

/** Univer's dialogs portal to <body>, outside the `.xlsx-surface` scope the
 *  repackaged stylesheet is bound to (@scope matches its root too), so the
 *  open dialog and its overlay join the scope; the pinned close button also
 *  labels itself with a literal "Close". */
function adoptOpenDialogs(doc: Document, scopeClass: string): void {
  ensurePortalRootDefaults(doc, scopeClass);
  for (const node of doc.querySelectorAll<HTMLElement>("body > [role=dialog], body > [data-state][class*='univer-']")) {
    node.classList.add(scopeClass);
  }
  for (const label of doc.querySelectorAll<HTMLElement>("body > [role=dialog] button > span.univer-sr-only")) {
    if (label.textContent === "Close") label.textContent = t("dvRejectClose");
  }
}

/** Remember the cell each write validates and title the pinned rejection
 *  dialog with that cell's rule. Sheet services exist only once a workbook
 *  unit started, so the controller calls this from loadWorkbook. */
export function installDvRejectDialogTitle(runtime: UniverRuntime, doc: Document, scopeClass: string): IDisposable {
  const injector = runtime.univer.__getInjector();
  let last: CellContext | null = null;
  const intercept = injector.get(SheetInterceptorService).writeCellInterceptor.intercept(VALIDATE_CELL, {
    priority: CONTEXT_PRIORITY,
    handler: (value, context, next) => {
      const { unitId, subUnitId, row, col } = context as CellContext;
      last = { unitId, subUnitId, row, col };
      return next(value);
    },
  });
  // The DI hands the dialog service out behind a lazy proxy (writes never
  // reach the instance the DV plugin calls), so the dialog list is observed
  // instead: the service emits its stored options synchronously and React
  // renders them a tick later, so retitling the stored option lands first.
  const dialogs = injector.get(IDialogService) as unknown as {
    getDialogs$(): { subscribe(next: (options: DialogConfig[]) => void): { unsubscribe(): void } };
  };
  const subscription = dialogs.getDialogs$().subscribe((options) => {
    const reject = options.find((option) => option.id === REJECT_DIALOG_ID && option.open);
    if (!reject || !last) return;
    const title = ruleTitle(runtime, last);
    if (title) reject.title = { ...reject.title, title };
    requestAnimationFrame(() => adoptOpenDialogs(doc, scopeClass));
  });
  return {
    dispose() {
      intercept();
      subscription.unsubscribe();
    },
  };
}

