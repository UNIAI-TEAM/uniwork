import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { DocumentTypeIcon } from "@uniwork/views/documents/document-type-icon";
import type { DesktopDocumentFormat } from "../shared/document-formats";

/** The formats a user can start from blank, in menu order, with the label key
 * under `officeDesktop.tabs`. Blank-document bytes exist for each in main. */
export const CREATE_CHOICES: readonly { format: DesktopDocumentFormat; labelKey: "createDocx" | "createMarkdown" | "createHtml" }[] = [
  { format: "docx", labelKey: "createDocx" },
  { format: "md", labelKey: "createMarkdown" },
  { format: "html", labelKey: "createHtml" },
];

/** The create-format items shared by the tab strip's "+" menu. */
export function CreateDocumentItems({ disabled, onCreate }: { disabled?: boolean; onCreate: (format: DesktopDocumentFormat) => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.tabs" });
  return <>{CREATE_CHOICES.map(({ format, labelKey }) => <DropdownMenuItem key={format} disabled={disabled} onClick={() => onCreate(format)}><DocumentTypeIcon format={format} className="size-4" />{t(labelKey)}</DropdownMenuItem>)}</>;
}

/** A labelled button that opens the create-format choices (home and library). */
export function CreateDocumentMenu({ label, disabled, variant = "outline", onCreate }: { label: string; disabled?: boolean; variant?: "default" | "outline"; onCreate: (format: DesktopDocumentFormat) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant={variant} disabled={disabled} />}>{label}</DropdownMenuTrigger>
      <DropdownMenuContent align="end"><CreateDocumentItems onCreate={onCreate} /></DropdownMenuContent>
    </DropdownMenu>
  );
}
