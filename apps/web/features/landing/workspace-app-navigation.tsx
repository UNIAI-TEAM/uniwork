"use client";
import { BookOpen, Building2, House, Layers, MessageSquare, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DEMO_FEATURES as PRODUCT_FEATURES, type ProductFeature } from "./showcase";

const APP_SECTIONS = [
  { key: "home", icon: House, target: "today" },
  { key: "work", icon: Layers, target: "tasks" },
  { key: "connect", icon: MessageSquare, target: "chat" },
  { key: "docs", icon: BookOpen, target: "documents" },
  { key: "ai", icon: Sparkles, target: "ask" },
  { key: "team", icon: Building2, target: "organization" }, // plan-literal-ok: rail section key
] as const satisfies ReadonlyArray<{ key: string; icon: typeof House; target: ProductFeature }>;

/** The app rail represents destinations; the outer tabs select detailed demos. */
export function WorkspaceAppNavigation({ mode, onSelect }: {
  mode: ProductFeature;
  onSelect: (key: ProductFeature) => void;
}) {
  const { t } = useTranslation();
  const feature = PRODUCT_FEATURES.find(item => item.key === mode)!;
  const active = mode === "today" ? "home"
    : feature.group === "communication" ? "connect"
    : feature.group === "results" || feature.group === "knowledge" ? "docs"
    : feature.group === "organization" ? "team" : feature.group; // plan-literal-ok: rail section key

  return <nav className="workspace-app-nav dark" aria-label={t("landing.workspace.appNavigation")}>
    {APP_SECTIONS.map(({ key, icon: Icon, target }) => <button
      key={key}
      type="button"
      data-app-section={key}
      aria-current={active === key ? "page" : undefined}
      onClick={() => { if (active !== key) onSelect(target); }}
    >
      <Icon aria-hidden />
      <span>{t(`landing.workspace.appSections.${key}`)}</span>
    </button>)}
  </nav>;
}
