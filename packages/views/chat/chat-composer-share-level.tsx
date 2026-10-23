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
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";

const LEVELS: readonly ChatDocumentShareLevel[] = ["view", "comment", "edit"];

/**
 * UNI-1966: the level a document goes out at — for a staged file, and (UNI-2012)
 * for a document picked from the library. There is no "plain file" choice: a
 * document always carries rights. The level names come from the share
 * dialog's own vocabulary (documents.share.level_*) so the room reads the same
 * words everywhere.
 */
export function ChatComposerShareLevelPicker({
  value,
  onChange,
  disabled,
}: {
  value: ChatDocumentShareLevel;
  onChange: (level: ChatDocumentShareLevel) => void;
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
            <span className="text-caption">{t(`documents.share.level_${value}`)}</span>
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
              if (next === "view" || next === "comment" || next === "edit") onChange(next);
            }}
          >
            {LEVELS.map((level) => (
              <DropdownMenuRadioItem key={level} value={level} className="pointer-coarse:min-h-11">
                {t(`documents.share.level_${level}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
