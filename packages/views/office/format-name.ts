import { useTranslation } from "react-i18next";

/** The reader's name of an Office format id (`docx` -> "Word document"), or the id in capitals. */
export function useOfficeFormatName(): (format: string) => string {
  const { t } = useTranslation();
  return (format) => t(`office.formatName.${format}`, { defaultValue: format.toUpperCase() });
}
