import { useMemo, type ComponentProps, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import { Button } from "@uniwork/ui/components/ui/button";
import { OfficeShell } from "@uniwork/views/office/office-shell";
import { PptxEditor, type PptxEditorProps } from "@uniwork/views/office/pptx";
import type { ReadOnlyReason } from "../tabs/use-document-tabs";
import { FeatureOffNotice } from "./feature-off-notice";

/** The format's display name for the feature-off notice, from the shared `office.formatName` glossary. */
export function useFeatureOffFormatName(format: string): string {
  const { t } = useTranslation(undefined, { keyPrefix: "office" });
  return t(`formatName.${format}`, { defaultValue: format.toUpperCase() });
}

/** A cloud tab that is view-only because of its format's Office flag: the one neutral notice above the
 * read-only body (when there is one) and a Back button like the byte and XLSX shells. The status is
 * pinned to "ready" so the shell shows no permission chip or alert. */
export function FeatureOffShell({ format, reason, title, breadcrumbs, onBack, children }: {
  format: string; reason: ReadOnlyReason; title: ReactNode; breadcrumbs?: ComponentProps<typeof OfficeShell>["breadcrumbs"]; onBack: () => void; children?: ReactNode;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const formatName = useFeatureOffFormatName(format);
  return <OfficeShell title={title} breadcrumbs={breadcrumbs} saveStatus="ready" editorReady={false}
    actions={<Button type="button" variant="outline" onClick={onBack}>{t("back")}</Button>}
    editor={<><FeatureOffNotice formatName={formatName} reason={reason} className="mx-4 my-2" />{children}</>} />;
}

/**
 * The opened deck, view-only: the shared PPTX editor mounted with no edit port
 * (no text, transform, panel or delete channel, and a handle without `edit`), the
 * same way the web host shows a read-only deck. Slide selection, find and the show
 * stay live because they never mutate the deck. The tab session owns disposal, so
 * the editor gets a handle whose dispose is inert.
 */
export function ReadOnlyDeck({ host, editorHandle, deck, slides, selectedIndex, onSlideSelect }: {
  host: OfficeHost; editorHandle: EditorHandle; deck: PptxEditorProps["deck"]; slides: PptxEditorProps["slides"]; selectedIndex: number; onSlideSelect: (index: number) => void;
}) {
  const viewHandle = useMemo<EditorHandle>(() => {
    const view: EditorHandle & { edit?: unknown } = { ...editorHandle, dispose: async () => undefined };
    delete view.edit;
    return view;
  }, [editorHandle]);
  return <section className="flex min-h-0 flex-1 flex-col" data-testid="readonly-deck">
    <PptxEditor host={host} editorHandle={viewHandle} deck={deck} slides={slides} selectedIndex={selectedIndex} onSlideSelect={onSlideSelect} printPort={null} includeSave={false} />
  </section>;
}
