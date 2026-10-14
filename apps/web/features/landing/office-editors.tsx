"use client";
import { Check } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { OFFICE_EDITOR_ICONS, OFFICE_EDITOR_KEYS, OFFICE_EXAMPLES, officeShotSrc, type OfficeEditorKey } from "./office-data";

/** Source-keyed captures recover when the visitor chooses another editor or language. */
function OfficeCapture({ src, theme, alt, unavailable, priority }: {
  src: string;
  theme: "light" | "dark";
  alt: string;
  unavailable: string;
  priority: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = image.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) return <p className={`office-shot-${theme} office-preview-error`} role="status">{unavailable}</p>;
  return <Image ref={image} className={`office-shot-${theme}`} data-theme={theme} src={src} width={2400} height={1500} alt={alt}
    sizes="(min-width: 1100px) 800px, calc(100vw - 40px)" priority={priority} unoptimized onError={() => setFailed(true)} />;
}

/** CSS selects the correct capture before hydration, including manually selected themes. */
function OfficeShot({ editor, priority = false }: { editor: OfficeEditorKey; priority?: boolean }) {
  const { t, i18n } = useTranslation();
  const alt = t("landing.office.editors.imageAlt", { editor: t(`landing.office.editors.${editor}.name`) });
  return <figure className="office-shot">
    <div className="office-shot-frame">{(["light", "dark"] as const).map(theme => {
      const src = officeShotSrc(editor, i18n.language, theme);
      return <OfficeCapture key={src} src={src} theme={theme} alt={alt} unavailable={t("landing.office.editors.imageUnavailable")} priority={priority} />;
    })}</div>
    <figcaption>{t("landing.office.editors.imageCaption")}</figcaption>
  </figure>;
}

/** The tabbed overview: one tab per editor, the selected editor's screenshot below. */
export function OfficeEditorTabs({ active, onActiveChange }: {
  active: OfficeEditorKey;
  onActiveChange: (editor: OfficeEditorKey) => void;
}) {
  const { t } = useTranslation();
  return <Tabs value={active} onValueChange={(value) => onActiveChange(value as OfficeEditorKey)} className="office-tabs">
    <TabsList aria-label={t("landing.office.editors.tabs")} className="office-tab-list">
      {OFFICE_EDITOR_KEYS.map((key) => {
        const Icon = OFFICE_EDITOR_ICONS[key];
        return <TabsTrigger key={key} value={key} className="office-tab"><Icon aria-hidden />{t(`landing.office.editors.${key}.name`)}</TabsTrigger>;
      })}
    </TabsList>
    {OFFICE_EDITOR_KEYS.map((key) => <TabsContent key={key} value={key} className="office-tab-panel" aria-describedby="office-editor-description">
      <OfficeShot editor={key} priority={key === "docs"} />
      <OfficeEditorSummary editor={key} />
    </TabsContent>)}
  </Tabs>;
}

/** Selected capabilities supplement the single preview without repeating its controls or image. */
function OfficeEditorSummary({ editor }: { editor: OfficeEditorKey }) {
  const { t } = useTranslation();
  const example = OFFICE_EXAMPLES[editor];
  return <section id="office-editor-details" className="office-editor-summary" aria-labelledby="office-editor-summary-title">
    <div><h2 id="office-editor-summary-title">{t(`landing.office.editors.${editor}.title`)}</h2>
      <p id="office-editor-description">{t(`landing.office.editors.${editor}.description`)}</p>
      <div className="office-editor-example" data-office-example={example}>
        <h3>{t("landing.office.editors.example", { title: t(`landing.office.tasks.${example}.title`) })}</h3>
        <p>{t(`landing.office.tasks.${example}.description`)}</p>
      </div>
    </div>
    <ul className="office-editor-points">{[1, 2, 3].map(n => <li key={n}><Check aria-hidden />{t(`landing.office.editors.${editor}.p${n}`)}</li>)}</ul>
  </section>;
}
