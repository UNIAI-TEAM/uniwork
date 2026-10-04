"use client";

// B5 (UNI-924): the Home tab's list-style gallery. Each entry is a preset
// definition (bullet library / numbering library / multilevel library); the
// pick applies it to the selection through commands/numbering.ts, which
// registers the definition and overlays it for immediate markers.
import { List } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { listPresetsOf, type DocxListPreset, type DocxListPresetGroup, type DocxListPresetId } from "./list-numbering";

export interface ListStyleGalleryProps {
  disabled?: boolean;
  onPick(id: DocxListPresetId): void;
}

const GALLERY_GROUPS: readonly { group: DocxListPresetGroup; labelKey: string }[] = [
  { group: "bullets", labelKey: "office.docx.lists.groupBullets" },
  { group: "numbers", labelKey: "office.docx.lists.groupNumbers" },
  { group: "multilevel", labelKey: "office.docx.lists.groupMultilevel" },
];

/** The entry's accessible name: the group name plus the sample it draws. */
function presetLabelKey(entry: DocxListPreset): string {
  if (entry.group === "bullets") return "office.docx.lists.presetBullet";
  if (entry.group === "numbers") return "office.docx.lists.presetNumber";
  return "office.docx.lists.presetMultilevel";
}

export function ListStyleGallery({ disabled = false, onPick }: ListStyleGalleryProps) {
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
            aria-label={t("office.docx.lists.gallery")}
            data-testid="docx-list-gallery"
          />
        }
      >
        <List aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {GALLERY_GROUPS.map(({ group, labelKey }, index) => (
          <DropdownMenuGroup key={group}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{t(labelKey)}</DropdownMenuLabel>
            {listPresetsOf(group).map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                onClick={() => onPick(entry.id)}
                data-testid={`docx-list-preset-${entry.id}`}
              >
                <span className="w-20 shrink-0 truncate text-muted-foreground">{entry.sampleChain}</span>
                <span className="truncate">{t(presetLabelKey(entry), { sample: entry.sample, glyph: entry.sample })}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
