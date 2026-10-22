"use client";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

const SYSTEMS = ["windows", "macos", "linux"] as const;

/** How each system keeps UniOffice current: short and scannable, no promises beyond the three facts. */
export function SelfUpdate() {
  const { t } = useTranslation();
  return <section className="ver-card ver-update" aria-labelledby="ver-update-title">
    <header className="ver-card-head">
      <span className="ver-card-icon" aria-hidden><RefreshCw /></span>
      <div><h3 id="ver-update-title">{t("landing.office.versions.autoUpdate.title")}</h3><p>{t("landing.office.versions.autoUpdate.sub")}</p></div>
    </header>
    <dl className="ver-update-list">
      {SYSTEMS.map((os) => <div key={os}>
        <dt>{t(`office.desktop.install.os.${os}`)}</dt>
        <dd>{t(`landing.office.versions.autoUpdate.${os}`)}</dd>
      </div>)}
    </dl>
  </section>;
}
