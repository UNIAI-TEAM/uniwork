import { useTranslation } from "react-i18next";

/**
 * Accessible name for a picker trigger. A trigger's `aria-label` replaces its
 * visible text, so a name holding only the field ("Trạng thái") hides the
 * value the trigger shows ("Đang làm") from speech-input users who say what
 * they see (WCAG 2.5.3 label in name). With a visible value the name is
 * "field: value"; without one, the field alone.
 */
export function usePickerTriggerLabel(field: string, value?: string): string {
  const { t } = useTranslation();
  return value ? t("tasks.picker_trigger_label", { field, value }) : field;
}
