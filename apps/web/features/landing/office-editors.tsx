"use client";
import { Check } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { OFFICE_EDITOR_ICONS, OFFICE_EDITOR_KEYS, officeShotSrc, type OfficeEditorKey } from "./office-data";

/**
 * A real capture of the editor. A shot that cannot load removes its frame
 * instead of leaving a broken image behind. An image that failed before React
 * attached `onError` (server HTML, slow hydration) is caught by the effect.
 */
export function OfficeShot({ editor, priority = false }: { editor: OfficeEditorKey; priority?: boolean }) {
  const { t, i18n } = useTranslation();
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = image.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) return null;
  return <figure className="office-shot">
    <Image ref={image} src={officeShotSrc(editor, i18n.language)} width={2400} height={1500} alt={t("landing.office.editors.imageAlt", { editor: t(`landing.office.editors.${editor}.name`) })}
      sizes="(min-width: 1360px) 1296px, 100vw" priority={priority} unoptimized onError={() => setFailed(true)} />
  </figure>;
}

/** The tabbed overview: one tab per editor, the selected editor's screenshot below. */
export function OfficeEditorTabs({ active, onActiveChange }: { active: OfficeEditorKey; onActiveChange: (editor: OfficeEditorKey) => void }) {
  const { t } = useTranslation();
  return <Tabs value={active} onValueChange={(value) => onActiveChange(value as OfficeEditorKey)} className="office-tabs">
    <TabsList aria-label={t("landing.office.editors.tabs")} className="office-tab-list">
      {OFFICE_EDITOR_KEYS.map((key) => {
        const Icon = OFFICE_EDITOR_ICONS[key];
        return <TabsTrigger key={key} value={key} className="office-tab"><Icon aria-hidden />{t(`landing.office.editors.${key}.name`)}</TabsTrigger>;
      })}
    </TabsList>
    {OFFICE_EDITOR_KEYS.map((key) => <TabsContent key={key} value={key} className="office-tab-panel">
      <OfficeShot editor={key} />
      <p className="office-tab-caption">{t(`landing.office.editors.${key}.description`)}</p>
    </TabsContent>)}
  </Tabs>;
}

/** The six stacked blocks, screenshot and text alternating sides. */
export function OfficeEditorBlocks() {
  const { t } = useTranslation();
  return <div className="office-blocks">{OFFICE_EDITOR_KEYS.map((key) => {
    const Icon = OFFICE_EDITOR_ICONS[key];
    return <section className="office-block" key={key} id={`office-block-${key}`} aria-labelledby={`office-block-${key}-title`}>
      <div className="office-block-copy">
        <span className="office-block-kicker"><Icon aria-hidden />{t(`landing.office.editors.${key}.name`)}</span>
        <h3 id={`office-block-${key}-title`}>{t(`landing.office.editors.${key}.title`)}</h3>
        <ul>{[1, 2, 3].map((n) => <li key={n}><Check aria-hidden />{t(`landing.office.editors.${key}.p${n}`)}</li>)}</ul>
      </div>
      <OfficeShot editor={key} />
    </section>;
  })}</div>;
}
