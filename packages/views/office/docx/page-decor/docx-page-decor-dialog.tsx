"use client";

// B6 (UNI-924): the Layout ▸ Page decoration dialog. Watermark, page colour,
// page borders and theme colours/fonts are edited as one draft and emitted as
// the minimal op list on Apply; the command area records them for the save.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DocxPageDecorEdit } from "@uniwork/office-engine/docx";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { DocxBordersPanel } from "./borders-panel";
import { decorDraftFromView, editsFromDraft, type DocxPageDecorDraft, type DocxPageDecorView } from "./docx-page-decor";
import { DocxPageColorPanel } from "./page-color-panel";
import { DocxThemePanel } from "./theme-panel";
import { DocxWatermarkPanel } from "./watermark-panel";

export interface DocxPageDecorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The document's decoration state + the section at the cursor. */
  state: DocxPageDecorView;
  /** Read-only documents keep the fields visible but block Apply. */
  readOnly?: boolean;
  /** The caller records the ops and closes the dialog. */
  onApply: (edits: DocxPageDecorEdit[]) => void;
}

export function DocxPageDecorDialog({ open, onOpenChange, state, readOnly = false, onApply }: DocxPageDecorDialogProps) {
  const { t } = useTranslation();
  // The dialog targets the state it was opened on; a modal blocks moving the
  // caret, and the seed must not follow live refreshes.
  const [initial] = useState<DocxPageDecorDraft>(() => decorDraftFromView(state));
  const [draft, setDraft] = useState<DocxPageDecorDraft>(initial);
  const resolved = useMemo(() => editsFromDraft(draft, initial, state), [draft, initial, state]);
  const patch = (next: Partial<DocxPageDecorDraft>) => setDraft((current) => ({ ...current, ...next }));

  const apply = () => {
    if (readOnly || resolved.error !== null) return;
    if (resolved.edits.length > 0) onApply(resolved.edits);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="docx-page-decor-dialog" className="gap-4 sm:max-w-2xl" closeLabel={t("common.close")}>
        <DialogHeader className="gap-1">
          <DialogTitle>{t("office.docx.pageDecor.title")}</DialogTitle>
          <DialogDescription>
            {t("office.docx.pageDecor.section", { current: state.activeIndex + 1, total: Math.max(state.sections.length, 1) })}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="watermark" className="gap-3">
          <TabsList aria-label={t("office.docx.pageDecor.tabsLabel")}>
            <TabsTrigger value="watermark" data-testid="docx-page-decor-tab-watermark">
              {t("office.docx.pageDecor.tabs.watermark")}
            </TabsTrigger>
            <TabsTrigger value="color" data-testid="docx-page-decor-tab-color">
              {t("office.docx.pageDecor.tabs.color")}
            </TabsTrigger>
            <TabsTrigger value="borders" data-testid="docx-page-decor-tab-borders">
              {t("office.docx.pageDecor.tabs.borders")}
            </TabsTrigger>
            <TabsTrigger value="theme" data-testid="docx-page-decor-tab-theme">
              {t("office.docx.pageDecor.tabs.theme")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="watermark">
            <DocxWatermarkPanel draft={draft} readOnly={readOnly} patch={patch} />
          </TabsContent>
          <TabsContent value="color">
            <DocxPageColorPanel draft={draft} readOnly={readOnly} patch={patch} />
          </TabsContent>
          <TabsContent value="borders">
            <DocxBordersPanel draft={draft} readOnly={readOnly} patch={patch} />
          </TabsContent>
          <TabsContent value="theme">
            <DocxThemePanel draft={draft} readOnly={readOnly} patch={patch} />
          </TabsContent>
        </Tabs>

        {resolved.error ? (
          <p role="alert" className="text-caption text-destructive">
            {t(`office.docx.pageDecor.error.${resolved.error}`)}
          </p>
        ) : (
          <p className="text-caption text-muted-foreground">{t("office.docx.pageDecor.hint")}</p>
        )}

        <DialogFooter className="flex-row items-center justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={readOnly || resolved.error !== null} onClick={apply} data-testid="docx-page-decor-apply">
            {t("office.docx.pageDecor.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
