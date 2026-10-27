"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

const DRIVE_PROMPT_HINT_KEYS = [
  "drive.proposals.prompt_hints.assignee_deadline",
  "drive.proposals.prompt_hints.scope",
  "drive.proposals.prompt_hints.priority",
] as const;

/**
 * Appends `hint` at the end of `current` prompt text without wiping user input.
 * Uses `". "` when the existing prompt does not already end with sentence
 * punctuation, or `" "` when it does.
 */
export function appendDrivePromptHint(current: string, hint: string): string {
  const trimmedHint = hint.trim();
  if (!trimmedHint) return current;
  const trimmedEnd = current.trimEnd();
  if (!trimmedEnd) return trimmedHint;
  const separator = /[.!?;:,]$/.test(trimmedEnd) ? " " : ". ";
  return `${trimmedEnd}${separator}${trimmedHint}`;
}

export interface DrivePromptHintsProps {
  onSelectHint: (hint: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Clickable prompt hint chips shown under the prompt box in the "Tạo việc từ tài liệu"
 * popover and the agent-mode panel with a Drive chip (UNI-2219).
 * Hidden when `disabled` is true (request pending, AI disabled, or access blocked).
 */
export function DrivePromptHints({
  onSelectHint,
  disabled = false,
  className,
}: DrivePromptHintsProps) {
  const { t } = useTranslation();
  if (disabled) return null;

  return (
    <div
      role="group"
      aria-label={t("drive.proposals.prompt_hints.group_aria")}
      data-testid="drive-prompt-hints"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {DRIVE_PROMPT_HINT_KEYS.map((key) => {
        const text = t(key);
        return (
          <Button
            key={key}
            type="button"
            variant="outline"
            size="xs"
            className="h-auto min-h-6 max-w-full py-1 text-left whitespace-normal text-muted-foreground hover:text-foreground"
            onClick={() => onSelectHint(text)}
          >
            {text}
          </Button>
        );
      })}
    </div>
  );
}
