import {
  Combine,
  FilePlus2,
  Highlighter,
  ImagePlus,
  ListRestart,
  Maximize,
  MessageSquareText,
  MoveHorizontal,
  RotateCw,
  Scissors,
  Stamp,
  StickyNote,
  TextCursorInput,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { RibbonIcon, RibbonItem, RibbonTab } from "../../ribbon";
import { PDF_COMMANDS, type PdfCommandId } from "../pdf-command-map";
import type { PdfToolbarCommand, PdfToolbarTab } from "../toolbar";

/** Key of the persisted ribbon-collapse preference for the PDF format. */
export const PDF_RIBBON_SCOPE = "pdf";

const TAB_LABEL_KEYS: Readonly<Record<PdfToolbarTab, string>> = {
  home: "office.pdf.chrome.tabs.home",
  annotate: "office.pdf.chrome.tabs.annotate",
  edit: "office.pdf.chrome.tabs.edit",
  pages: "office.pdf.chrome.tabs.pages",
  view: "office.pdf.chrome.tabs.view",
};

const PDF_RIBBON_COMMAND_LABEL_KEYS: Readonly<Record<PdfCommandId, string>> = {
  [PDF_COMMANDS.undo]: "office.pdf.actions.undo",
  [PDF_COMMANDS.redo]: "office.pdf.actions.redo",
  [PDF_COMMANDS.save]: "office.pdf.actions.save",
  [PDF_COMMANDS.annotations]: "office.pdf.commands.annotations",
  [PDF_COMMANDS.highlight]: "office.pdf.commands.highlight",
  [PDF_COMMANDS.note]: "office.pdf.commands.note",
  [PDF_COMMANDS.stamp]: "office.pdf.commands.stamp",
  [PDF_COMMANDS.forms]: "office.pdf.commands.forms",
  [PDF_COMMANDS.editText]: "office.pdf.commands.editText",
  [PDF_COMMANDS.replaceImage]: "office.pdf.commands.replaceImage",
  [PDF_COMMANDS.insertPage]: "office.pdf.commands.insertPage",
  [PDF_COMMANDS.deletePage]: "office.pdf.commands.deletePage",
  [PDF_COMMANDS.rotatePage]: "office.pdf.commands.rotatePage",
  [PDF_COMMANDS.reorderPage]: "office.pdf.commands.reorderPage",
  [PDF_COMMANDS.extractPage]: "office.pdf.commands.extractPage",
  [PDF_COMMANDS.mergePages]: "office.pdf.commands.mergePages",
  [PDF_COMMANDS.zoomOut]: "office.pdf.commands.zoomOut",
  [PDF_COMMANDS.zoomIn]: "office.pdf.commands.zoomIn",
  [PDF_COMMANDS.fitWidth]: "office.pdf.commands.fitWidth",
  [PDF_COMMANDS.fitPage]: "office.pdf.commands.fitPage",
};

const PDF_RIBBON_ICONS: Readonly<Partial<Record<PdfCommandId, RibbonIcon>>> = {
  [PDF_COMMANDS.annotations]: MessageSquareText,
  [PDF_COMMANDS.highlight]: Highlighter,
  [PDF_COMMANDS.note]: StickyNote,
  [PDF_COMMANDS.stamp]: Stamp,
  [PDF_COMMANDS.forms]: TextCursorInput,
  [PDF_COMMANDS.editText]: Type,
  [PDF_COMMANDS.replaceImage]: ImagePlus,
  [PDF_COMMANDS.insertPage]: FilePlus2,
  [PDF_COMMANDS.deletePage]: Trash2,
  [PDF_COMMANDS.rotatePage]: RotateCw,
  [PDF_COMMANDS.reorderPage]: ListRestart,
  [PDF_COMMANDS.extractPage]: Scissors,
  [PDF_COMMANDS.mergePages]: Combine,
  [PDF_COMMANDS.zoomOut]: ZoomOut,
  [PDF_COMMANDS.zoomIn]: ZoomIn,
  [PDF_COMMANDS.fitWidth]: MoveHorizontal,
  [PDF_COMMANDS.fitPage]: Maximize,
};

interface PdfRibbonGroupSpec {
  id: string;
  labelKey: string;
  ids: readonly PdfCommandId[];
}

/**
 * The PDF command map as ribbon data, grouped like the desktop Office ribbon.
 * Undo/redo live in the tab row's quick-access pair and Save in the shared
 * header cluster, so neither is repeated in a tab body. `home` is a real
 * Office-like Home (Edit, Annotate, Pages, Zoom) built from the same commands;
 * `view` carries zoom and fit groups (F-8), so no body is an empty band.
 */
const PDF_RIBBON_TABS: ReadonlyArray<{ id: PdfToolbarTab; groups: readonly PdfRibbonGroupSpec[] }> = [
  {
    id: "home",
    groups: [
      { id: "edit", labelKey: "office.pdf.chrome.groups.edit", ids: [PDF_COMMANDS.editText, PDF_COMMANDS.replaceImage] },
      {
        id: "annotate",
        labelKey: "office.pdf.chrome.groups.annotate",
        ids: [PDF_COMMANDS.highlight, PDF_COMMANDS.note, PDF_COMMANDS.stamp],
      },
      { id: "pages", labelKey: "office.pdf.pages.title", ids: [PDF_COMMANDS.insertPage, PDF_COMMANDS.rotatePage, PDF_COMMANDS.deletePage] },
      {
        id: "zoom",
        labelKey: "office.pdf.view.zoomGroup",
        ids: [PDF_COMMANDS.zoomOut, PDF_COMMANDS.zoomIn, PDF_COMMANDS.fitWidth, PDF_COMMANDS.fitPage],
      },
    ],
  },
  {
    id: "annotate",
    groups: [
      {
        id: "markups",
        labelKey: "office.pdf.markups.label",
        ids: [PDF_COMMANDS.annotations, PDF_COMMANDS.highlight, PDF_COMMANDS.note, PDF_COMMANDS.stamp],
      },
      { id: "forms", labelKey: "office.pdf.forms.title", ids: [PDF_COMMANDS.forms] },
    ],
  },
  {
    id: "edit",
    groups: [
      { id: "edit", labelKey: "office.pdf.chrome.groups.edit", ids: [PDF_COMMANDS.editText, PDF_COMMANDS.replaceImage] },
    ],
  },
  {
    id: "pages",
    groups: [
      { id: "pages", labelKey: "office.pdf.pages.title", ids: [PDF_COMMANDS.insertPage, PDF_COMMANDS.deletePage, PDF_COMMANDS.rotatePage] },
      { id: "pageOps", labelKey: "office.pdf.pageOps.title", ids: [PDF_COMMANDS.reorderPage, PDF_COMMANDS.extractPage, PDF_COMMANDS.mergePages] },
    ],
  },
  {
    id: "view",
    groups: [
      {
        id: "zoom",
        labelKey: "office.pdf.view.zoomGroup",
        ids: [PDF_COMMANDS.zoomOut, PDF_COMMANDS.zoomIn],
      },
      {
        id: "fit",
        labelKey: "office.pdf.view.fitGroup",
        ids: [PDF_COMMANDS.fitWidth, PDF_COMMANDS.fitPage],
      },
    ],
  },
];

/** Most items a group may show as labelled buttons (F4); beyond it the group packs icons in rows. */
const MAX_LABELLED_ITEMS = 3;
/** Icons per row in a packed icon group. */
const ICONS_PER_ROW = 2;

/**
 * Build the PDF ribbon tabs for the commands a host supplies. A group keeps its
 * declared order. With up to three present items the first renders large and
 * the rest small (icon + label); with more, every item is an icon packed in rows
 * of two, `rowBreak` on each later row's first item (F4). Groups
 * with no present command are dropped so no empty labelled box appears. The
 * first group of a tab collapses last, the rightmost first.
 */
export function createPdfRibbonTabs(
  commands: readonly PdfToolbarCommand[],
  onCommand?: (id: PdfCommandId) => void,
): RibbonTab[] {
  const commandById = new Map(commands.map((command) => [command.id, command] as const));
  return PDF_RIBBON_TABS.map((tab) => ({
    id: tab.id,
    labelKey: TAB_LABEL_KEYS[tab.id],
    groups: tab.groups
      .map((spec, index, all) => {
        const items: RibbonItem[] = [];
        const present = spec.ids.filter((id) => commandById.has(id));
        const packed = present.length > MAX_LABELLED_ITEMS;
        for (const id of present) {
          const command = commandById.get(id);
          if (!command) continue;
          const position = items.length;
          items.push({
            kind: "button",
            id,
            labelKey: PDF_RIBBON_COMMAND_LABEL_KEYS[id],
            icon: PDF_RIBBON_ICONS[id],
            size: packed ? "icon" : position === 0 ? "large" : "small",
            ...(packed && position > 0 && position % ICONS_PER_ROW === 0 ? { rowBreak: true } : {}),
            disabled: command.disabled,
            onExecute: () => {
              command.onExecute?.();
              onCommand?.(id);
            },
          });
        }
        return { id: spec.id, labelKey: spec.labelKey, priority: (all.length - index) * 10, items };
      })
      .filter((group) => group.items.length > 0),
  }));
}
