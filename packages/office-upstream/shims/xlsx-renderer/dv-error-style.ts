import { t } from "./locale";

// ── data-validation warning / information styles (UNI-953 X01) ─────────────
//
// The pinned DV plugin rejects invalid input only for the "stop" style and
// silently accepts it for "warning" and "information" (it just marks the
// cell). Excel asks instead: a warning asks whether to keep the value (Yes
// keeps it, No sends the user back), an information notice keeps it on OK and
// drops it on Cancel. This runs after the plugin's own verdict, before the
// write gate reads it, so a refused value is rolled back exactly like a stop.

/** Univer DataValidationErrorStyle: INFO=0, STOP=1, WARNING=2. */
const INFO = 0;
const WARNING = 2;

export interface DvErrorStyleCell {
  unitId: string;
  subUnitId: string;
  row: number;
  col: number;
}

interface DvErrorStyleRule {
  errorStyle?: unknown;
  error?: unknown;
  errorTitle?: unknown;
  showErrorMessage?: unknown;
}

export interface DvErrorStyleConfirm {
  id: string;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
}

/** What the settle step reads from the renderer: the cell's rule, whether
 *  the pending value passes it, and a confirm dialog (true = confirmed). */
export interface DvErrorStylePort {
  ruleAt(cell: DvErrorStyleCell): DvErrorStyleRule | null;
  isValid(cell: DvErrorStyleCell): Promise<boolean>;
  confirm(options: DvErrorStyleConfirm): Promise<boolean>;
}

export const DV_ERROR_STYLE_DIALOG_ID = "uniwork-dv-error-style";

function styleOf(rule: DvErrorStyleRule | null): number | null {
  const value = rule?.errorStyle;
  if (value === INFO || value === String(INFO)) return INFO;
  if (value === WARNING || value === String(WARNING)) return WARNING;
  return null;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** The final verdict for one validated write: the plugin's refusal stands,
 *  a value outside a warning / information rule (with its alert on) waits for
 *  the user's answer, everything else keeps the plugin's verdict. */
export async function settleDvErrorStyle(accepted: boolean, cell: DvErrorStyleCell, port: DvErrorStylePort): Promise<boolean> {
  if (!accepted) return false;
  const rule = port.ruleAt(cell);
  const style = styleOf(rule);
  if (style === null || rule?.showErrorMessage === false) return true;
  if (await port.isValid(cell)) return true;
  const message = text(rule?.error) ?? t("dvRejectTitle");
  return style === WARNING
    ? port.confirm({
      id: DV_ERROR_STYLE_DIALOG_ID,
      title: text(rule?.errorTitle) ?? t("dvWarningTitle"),
      message,
      confirmText: t("dvWarningYes"),
      cancelText: t("dvWarningNo"),
    })
    : port.confirm({
      id: DV_ERROR_STYLE_DIALOG_ID,
      title: text(rule?.errorTitle) ?? t("dvInfoTitle"),
      message,
      confirmText: t("dvInfoOk"),
      cancelText: t("dvInfoCancel"),
    });
}

const HINT_STYLE_ID = "uniwork-xlsx-dv-hint";

/** The pinned invalid-cell hint (the cell alert) is a fixed 156px box whose
 *  title row is one line high, so a longer title such as "Giá trị không hợp
 *  lệ:" wrapped into the message below it (visual-recheck2 minor 3). The box
 *  now grows to its content up to a readable width and the title row to its
 *  lines; the classes are the pinned component's own. */
export function ensureDvHintStyle(doc: Document): void {
  if (doc.getElementById(HINT_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = HINT_STYLE_ID;
  const box = "[class~='univer-w-[156px]'][class~='univer-rounded-lg'][class~='univer-shadow']";
  style.textContent = `${box}{width:max-content;min-width:156px;max-width:min(320px,80vw)}` +
    `${box}>[class~='univer-h-5']{height:auto;min-height:1.25rem;align-items:flex-start;overflow-wrap:anywhere}` +
    `${box}>[class~='univer-h-5']>svg{flex-shrink:0;margin-top:0.2rem}` +
    `${box}>[class~='univer-text-sm']{overflow-wrap:anywhere}`;
  doc.head.appendChild(style);
}
