"use client";

import { AlignCenter, AlignJustify, AlignLeft, AlignRight, IndentDecrease, IndentIncrease } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Toggle } from "@uniwork/ui/components/ui/toggle";
import type { RibbonItem } from "../../../ribbon";
import { homeListsRibbonItems } from "../../lists/home-lists";
import { ptFromTwips, type ParagraphAlign } from "../../paragraph/paragraph-format";
import { ParagraphSpacingPicker } from "../../paragraph/spacing-controls";
import type { DocxToolbarGroupContext } from "../types";

const ALIGNMENTS: readonly { align: ParagraphAlign; icon: typeof AlignLeft; labelKey: string }[] = [
  { align: "left", icon: AlignLeft, labelKey: "office.docx.toolbar.paragraph.alignLeft" },
  { align: "center", icon: AlignCenter, labelKey: "office.docx.toolbar.paragraph.alignCenter" },
  { align: "right", icon: AlignRight, labelKey: "office.docx.toolbar.paragraph.alignRight" },
  { align: "justify", icon: AlignJustify, labelKey: "office.docx.toolbar.paragraph.alignJustify" },
];

/**
 * The Home tab's paragraph group (task A3, C8 order): outdent/indent, the four
 * alignments and the line + paragraph spacing popover. The bullet/numbered
 * toggles the pre-wave base group carried duplicated the list gallery that
 * renders just before this group, so each control now appears once per tab
 * (C7); the list controls themselves live in lists/home-lists.tsx. Commands
 * come from commands/paragraph.ts and only map attrs the vendored paragraph
 * nodes already store.
 */
function HomeParagraphGroupView({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const blocked = readOnly || saving || !commands || !format;
  const align = format?.align ?? null;

  return (
    <div className="flex flex-nowrap items-center gap-1">
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.toolbar.paragraph.indentDecrease")}
        disabled={blocked}
        onClick={() => commands?.stepParagraphIndent(-1)}
        data-testid="docx-indent-decrease"
      >
        <IndentDecrease aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.toolbar.paragraph.indentIncrease")}
        disabled={blocked}
        onClick={() => commands?.stepParagraphIndent(1)}
        data-testid="docx-indent-increase"
      >
        <IndentIncrease aria-hidden />
      </Button>
      {ALIGNMENTS.map(({ align: value, icon: Icon, labelKey }) => (
        <Toggle
          key={value}
          type="button"
          variant="toolbar"
          size="sm"
          pressed={align === value}
          onPressedChange={() => commands?.setParagraphAlign(value)}
          disabled={blocked}
          aria-label={t(labelKey)}
          data-testid={`docx-align-${value}`}
        >
          <Icon aria-hidden />
        </Toggle>
      ))}
      <ParagraphSpacingPicker
        lineSpacing={format?.lineSpacing ?? null}
        spaceBeforePt={ptFromTwips(format?.spaceBeforeTwips ?? null)}
        spaceAfterPt={ptFromTwips(format?.spaceAfterTwips ?? null)}
        disabled={blocked}
        onLineSpacing={(multiple) => commands?.setLineSpacing(multiple)}
        onSpaceBefore={(pt) => commands?.setSpaceBeforePt(pt)}
        onSpaceAfter={(pt) => commands?.setSpaceAfterPt(pt)}
      />
    </div>
  );
}

/**
 * Typed ribbon items for the paragraph group (R7), laid out like Word's two
 * icon rows. Row 1: list styles, multilevel, outdent, indent (the list controls
 * come from lists/home-lists.tsx, so their commands are not duplicated; the
 * Lists group is merged here). Row 2 (rowBreak on Align left): the four
 * alignments as toggles and the line + paragraph spacing popover, a `custom`
 * item because its custom multiple and before/after inputs do not fit the
 * dropdown model. Every item calls the same command the legacy component called.
 */
export function homeParagraphRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const { format, commands, readOnly, saving } = context;
  const blocked = readOnly || saving || !commands || !format;
  const align = format?.align ?? null;

  return [
    ...homeListsRibbonItems(context).map((item) => ({ ...item, size: "icon" as const, collapseAs: "icon" as const })),
    {
      kind: "button",
      id: "docx-indent-decrease",
      labelKey: "office.docx.toolbar.paragraph.indentDecrease",
      icon: IndentDecrease,
      size: "icon",
      collapseAs: "icon",
      disabled: blocked,
      onExecute: () => commands?.stepParagraphIndent(-1),
    },
    {
      kind: "button",
      id: "docx-indent-increase",
      labelKey: "office.docx.toolbar.paragraph.indentIncrease",
      icon: IndentIncrease,
      size: "icon",
      collapseAs: "icon",
      disabled: blocked,
      onExecute: () => commands?.stepParagraphIndent(1),
    },
    ...ALIGNMENTS.map(({ align: value, icon, labelKey }, index): RibbonItem => ({
      kind: "toggle",
      id: `docx-align-${value}`,
      labelKey,
      icon,
      size: "icon",
      collapseAs: "icon",
      rowBreak: index === 0,
      pressed: align === value,
      disabled: blocked,
      onExecute: () => commands?.setParagraphAlign(value),
    })),
    {
      kind: "custom",
      id: "docx-paragraph-spacing",
      labelKey: "office.docx.toolbar.paragraph.spacing",
      size: "icon",
      collapseAs: "icon",
      disabled: blocked,
      width: 34,
      render: () => (
        <ParagraphSpacingPicker
          lineSpacing={format?.lineSpacing ?? null}
          spaceBeforePt={ptFromTwips(format?.spaceBeforeTwips ?? null)}
          spaceAfterPt={ptFromTwips(format?.spaceAfterTwips ?? null)}
          disabled={blocked}
          onLineSpacing={(multiple) => commands?.setLineSpacing(multiple)}
          onSpaceBefore={(pt) => commands?.setSpaceBeforePt(pt)}
          onSpaceAfter={(pt) => commands?.setSpaceAfterPt(pt)}
        />
      ),
    },
  ];
}

/** The paragraph group: the typed items live on the registry entry, and the
 * legacy component stays exported for hosts that want the inline control. */
export const HomeParagraphGroup = Object.assign(HomeParagraphGroupView, {
  ribbonItems: homeParagraphRibbonItems,
});

