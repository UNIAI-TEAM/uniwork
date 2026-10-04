"use client";

import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { DOCX_STYLES_GALLERY, type DocxGalleryStyleId } from "./styles-gallery";

export interface StylesGalleryProps {
  /** The gallery entry the caret's block matches; null = a style outside it. */
  value: DocxGalleryStyleId | null;
  disabled?: boolean;
  onPick(style: DocxGalleryStyleId): void;
}

/** The Home tab's styles gallery (task A3): the fixed Word gallery set. The
 * trigger shows the current style's name in its own preview voice; the menu
 * marks the active entry and applies a pick to the whole selection. */
export function StylesGallery({ value, disabled = false, onPick }: StylesGalleryProps) {
  const { t } = useTranslation();
  const active = DOCX_STYLES_GALLERY.find((entry) => entry.id === value) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            disabled={disabled}
            aria-label={t("office.docx.styles.gallery")}
            data-testid="docx-styles-gallery"
          />
        }
      >
        <span className={cn("max-w-40 truncate", active?.previewClass)}>
          {active ? t(active.labelKey, active.level ? { level: active.level } : undefined) : t("office.docx.styles.other")}
        </span>
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 max-w-[calc(100vw-2rem)] overflow-x-auto">
        {/* A style pick is single-select, so the group is a radio: Base UI
            dismisses the menu on pick and the indicator marks the active one. */}
        <DropdownMenuRadioGroup
          value={value ?? ""}
          onValueChange={(next) => onPick(next as DocxGalleryStyleId)}
        >
          {DOCX_STYLES_GALLERY.map((entry) => (
            <DropdownMenuRadioItem
              key={entry.id}
              value={entry.id}
              data-testid={`docx-style-${entry.id}`}
              className="py-1.5"
            >
              <span className={cn("truncate", entry.previewClass)}>
                {t(entry.labelKey, entry.level ? { level: entry.level } : undefined)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
