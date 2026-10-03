"use client";

import { Bold, Italic, List, ListOrdered, Underline as UnderlineIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select } from "@uniwork/ui/components/ui/select";
import type { DocxToolbarGroupContext } from "../types";

/** A1-owned pre-wave surface: bold/italic/underline and the paragraph-kind
 * controls that already shipped. Wave-A groups (A2 character, A3 paragraph
 * and styles) add their commands in their own files next to this one. */
export function HomeBaseFormatGroup({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const blocked = readOnly || saving || !commands || !format;
  const headingValue = format?.headingLevel ? String(format.headingLevel) : "paragraph";

  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.commands.bold")}
        aria-pressed={format?.bold ?? false}
        disabled={blocked}
        onClick={() => commands?.toggleBold()}
      >
        <Bold aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.commands.italic")}
        aria-pressed={format?.italic ?? false}
        disabled={blocked}
        onClick={() => commands?.toggleItalic()}
      >
        <Italic aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.commands.underline")}
        aria-pressed={format?.underline ?? false}
        disabled={blocked}
        onClick={() => commands?.toggleUnderline()}
      >
        <UnderlineIcon aria-hidden />
      </Button>
      <Select
        aria-label={t("office.docx.commands.heading")}
        triggerVariant="subtle"
        value={headingValue}
        disabled={blocked}
        onValueChange={(value) => commands?.setHeading(value === "paragraph" ? null : Number(value))}
        items={[
          { value: "paragraph", label: t("office.docx.commands.headingParagraph") },
          { value: "1", label: t("office.docx.commands.headingLevel", { level: "1" }) },
          { value: "2", label: t("office.docx.commands.headingLevel", { level: "2" }) },
          { value: "3", label: t("office.docx.commands.headingLevel", { level: "3" }) },
        ]}
      />
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.commands.bulletList")}
        aria-pressed={format?.listKind === "bullet"}
        disabled={blocked}
        onClick={() => commands?.toggleList("bullet")}
      >
        <List aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.commands.orderedList")}
        aria-pressed={format?.listKind === "ordered"}
        disabled={blocked}
        onClick={() => commands?.toggleList("ordered")}
      >
        <ListOrdered aria-hidden />
      </Button>
    </>
  );
}
