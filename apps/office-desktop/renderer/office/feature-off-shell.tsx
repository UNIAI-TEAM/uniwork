import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { OfficeShell } from "@uniwork/views/office/office-shell";
import { FeatureOffNotice } from "./feature-off-notice";

/** The format's display name for the feature-off notice, from the shared `office.formatName` glossary. */
export function useFeatureOffFormatName(format: string): string {
  const { t } = useTranslation(undefined, { keyPrefix: "office" });
  return t(`formatName.${format}`, { defaultValue: format.toUpperCase() });
}

/** A flag-off PPTX tab: the deck canvas cannot mount read-only, so the shell body is the one neutral
 * notice. The status is pinned to "ready" so the shell shows no permission chip or alert. */
export function FeatureOffShell({ format, title, breadcrumbs, actions }: { format: string; title: ReactNode; breadcrumbs?: ComponentProps<typeof OfficeShell>["breadcrumbs"]; actions?: ReactNode }) {
  const formatName = useFeatureOffFormatName(format);
  return <OfficeShell title={title} breadcrumbs={breadcrumbs} saveStatus="ready" editorReady={false} actions={actions}
    editor={<FeatureOffNotice formatName={formatName} className="mx-4 my-2" />} />;
}
