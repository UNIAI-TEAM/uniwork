"use client";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { PRODUCT_FEATURES, PRODUCT_GROUPS, type ProductFeature } from "./showcase";

export function WorkspaceNavigation({ mode, onSelect }: { mode: ProductFeature; onSelect: (key: ProductFeature) => void }) {
  const { t } = useTranslation();
  const current = PRODUCT_FEATURES.find(item => item.key === mode)!;
  return <div className="workspace-selector">
    <div className="workspace-feature-groups" aria-label={t("landing.catalog.navigation")}>
      {PRODUCT_GROUPS.map(({ key, icon: Icon }) => {
        const items = PRODUCT_FEATURES.filter(item => item.group === key);
        const active = current.group === key;
        const label = t(`landing.catalog.groups.${key}`);
        return <div className="workspace-feature-group" key={key}>
          <button type="button" className="workspace-group-button" data-feature-group={key} aria-expanded={active} aria-controls={active ? `workspace-group-${key}` : undefined} onClick={() => { if (!active) onSelect(items[0]!.key); }}>
            <Icon aria-hidden /><span>{label}</span><ChevronDown aria-hidden />
          </button>
          {active && <TabsList id={`workspace-group-${key}`} className="workspace-tabs" aria-label={label} activateOnFocus={false}>
            {items.map(({ key: itemKey, icon: ItemIcon, label: itemLabel, status }) => <TabsTrigger key={itemKey} value={itemKey} data-feature={itemKey}>
              <ItemIcon aria-hidden /><span>{t(itemLabel)}</span>
              <span className="workspace-preview-kind">{t(`landing.revision.${status}`)}</span>
            </TabsTrigger>)}
          </TabsList>}
        </div>;
      })}
    </div>
    <p className="workspace-feature-description">{t(current.description)}</p>
  </div>;
}
