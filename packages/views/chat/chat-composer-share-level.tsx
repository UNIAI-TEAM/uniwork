"use client";

import { ChevronDown, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatDocumentShareLevel } from "@uniwork/core/api/endpoints/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";

/** The picker's choices: a share level, or "file" for today's plain send. */
export type ChatComposerShareChoice = ChatDocumentShareLevel | "file";

const LEVELS: readonly ChatDocumentShareLevel[] = ["view", "comment", "edit"];

function choiceLabel(t: (key: string) => string, choice: ChatComposerShareChoice): string {
  return choice === "file"
    ? t("chat.composer_send_as_file")
    : t(`documents.share.level_${choice}`);
}

/**
 * UNI-1966: shown while a staged file may go out as a shared document. The
 * level names come from the share dialog's own vocabulary
 * (documents.share.level_*) so the room reads the same words everywhere.
 */
export function ChatComposerShareLevelPicker({
  value,
  onChange,
  disabled,
}: {
  value: ChatComposerShareChoice;
  onChange: (choice: ChatComposerShareChoice) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            // 44px on coarse pointers; the label names the whole control.
            className="pointer-coarse:min-h-11 h-8 shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground"
            aria-label={t("chat.composer_share_level")}
            disabled={disabled}
          >
            <FileText aria-hidden className="size-4" />
            <span className="text-caption">{choiceLabel(t, value)}</span>
            <ChevronDown aria-hidden className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" side="top" className="w-64" aria-label={t("chat.composer_share_level")}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("chat.composer_send_as_document")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => {
              if (typeof next === "string" && next) onChange(next as ChatComposerShareChoice);
            }}
          >
            {LEVELS.map((level) => (
              <DropdownMenuRadioItem key={level} value={level} className="pointer-coarse:min-h-11">
                {choiceLabel(t, level)}
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem value="file" className="pointer-coarse:min-h-11">
              {t("chat.composer_send_as_file")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
