"use client";

import { ALargeSmall } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import type { CaseCommandMode } from "./case-transform";

const CASE_ENTRIES: readonly { mode: CaseCommandMode; labelKey: string }[] = [
  { mode: "sentence", labelKey: "office.docx.character.caseSentence" },
  { mode: "lower", labelKey: "office.docx.character.caseLower" },
  { mode: "upper", labelKey: "office.docx.character.caseUpper" },
  { mode: "title", labelKey: "office.docx.character.caseTitle" },
  { mode: "toggle", labelKey: "office.docx.character.caseToggle" },
];

export interface CaseMenuProps {
  disabled: boolean;
  onPick(mode: CaseCommandMode): void;
}

export function CaseMenu({ disabled, onPick }: CaseMenuProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            disabled={disabled}
            aria-label={t("office.docx.character.changeCase")}
            data-testid="docx-change-case"
          />
        }
      >
        <ALargeSmall aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {CASE_ENTRIES.map((entry) => (
          <DropdownMenuItem key={entry.mode} onClick={() => onPick(entry.mode)} data-testid={`docx-change-case-${entry.mode}`}>
            {t(entry.labelKey)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
