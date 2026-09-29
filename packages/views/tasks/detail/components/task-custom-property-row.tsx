"use client";

import { useTranslation } from "react-i18next";
import type { Task, TaskProperty } from "@uniwork/core/types";
import { PROP_ROW_TRIGGER_CLASS, PropRow } from "../../../common/prop-row";
import { usePickerTriggerLabel } from "../../pickers/trigger-label";
import { formatPropertyValue } from "../../properties/property-value";
import { PropertyValueEditor } from "../../properties/property-value-editor";

/** One custom property of the task: its name, then the shared value editor. */
export function TaskCustomPropertyRow({
  task,
  property,
  onChange,
  onClear,
}: {
  task: Task;
  property: TaskProperty;
  onChange: (value: unknown) => void;
  onClear: () => void;
}) {
  const { t, i18n } = useTranslation();
  const value = task.properties?.[property.id];
  const shown = formatPropertyValue(property, value, i18n.language);
  // A checkbox shows no text, so its name is the field alone.
  const ariaLabel = usePickerTriggerLabel(
    property.name,
    property.type === "checkbox" ? undefined : shown || t("tasks.properties.empty"),
  );
  return (
    <PropRow label={<span className="truncate">{property.name}</span>}>
      <PropertyValueEditor
        property={property}
        value={value}
        onChange={onChange}
        onClear={onClear}
        ariaLabel={ariaLabel}
        triggerClassName={PROP_ROW_TRIGGER_CLASS}
      />
    </PropRow>
  );
}
